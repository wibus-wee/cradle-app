import { randomBytes } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { PluginProcessHandle, ServerPluginContext } from '@cradle/plugin-sdk/server'
import { z } from 'zod'

import { readRuntimeStatus } from './runtime'

const DEFAULT_PORT = 8317
const START_TIMEOUT_MS = 15_000
const HEALTH_RETRY_MS = 200
const DATA_PLANE_SECRET_KEY = 'data-plane-key'
const MANAGEMENT_SECRET_KEY = 'management-key'

const ModelListSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) }).passthrough()).default([]),
}).passthrough()

export interface CliProxyConfig {
  port: number
}

export interface CliProxySidecarStatus {
  installed: boolean
  version: string | null
  running: boolean
  healthy: boolean
  endpoint: string
  port: number
  models: string[]
  accountFileCount: number
  authenticatingProviders: string[]
  error: string | null
}

export type CliProxyAuthProvider = 'codex' | 'claude' | 'gemini'

const AUTH_FLAGS: Record<CliProxyAuthProvider, string> = {
  codex: '-codex-login',
  claude: '-claude-login',
  gemini: '-login',
}

function quoteYaml(value: string): string {
  return JSON.stringify(value)
}

function createSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function renderCliProxyConfig(input: {
  port: number
  authDir: string
  dataPlaneKey: string
  managementKey: string
}): string {
  return [
    `host: ${quoteYaml('127.0.0.1')}`,
    `port: ${input.port}`,
    `auth-dir: ${quoteYaml(input.authDir)}`,
    'api-keys:',
    `  - ${quoteYaml(input.dataPlaneKey)}`,
    'remote-management:',
    '  allow-remote: false',
    `  secret-key: ${quoteYaml(input.managementKey)}`,
    '  disable-control-panel: true',
    '  disable-auto-update-panel: true',
    'logging-to-file: false',
    'usage-statistics-enabled: false',
    '',
  ].join('\n')
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, ms))
}

export class CliProxySidecar {
  private processHandle: PluginProcessHandle | null = null

  constructor(private readonly ctx: ServerPluginContext) {}

  async readConfig(): Promise<CliProxyConfig> {
    const stored = await this.ctx.storage.get('port')
    const parsed = stored ? Number(stored) : DEFAULT_PORT
    return {
      port: Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : DEFAULT_PORT,
    }
  }

  async updateConfig(input: { port: number }): Promise<CliProxyConfig> {
    if (this.processHandle?.status()) {
      throw new Error('Stop CLIProxyAPI before changing its listener port.')
    }
    const port = z.number().int().min(1024).max(65535).parse(input.port)
    await this.ctx.storage.set('port', String(port))
    return { port }
  }

  private getOrCreateSecret(key: string): string {
    const existing = this.ctx.secrets.get(key)
    if (existing) { return existing }
    const created = createSecret()
    this.ctx.secrets.set(key, created)
    return created
  }

  private async writeConfig(config: CliProxyConfig): Promise<string> {
    const stateDir = path.join(this.ctx.paths.dataDir, 'state')
    const authDir = path.join(stateDir, 'auth')
    const configPath = path.join(stateDir, 'config.yaml')
    await mkdir(authDir, { recursive: true })
    const dataPlaneKey = this.getOrCreateSecret(DATA_PLANE_SECRET_KEY)
    const managementKey = this.getOrCreateSecret(MANAGEMENT_SECRET_KEY)
    const yaml = renderCliProxyConfig({
      port: config.port,
      authDir,
      dataPlaneKey,
      managementKey,
    })
    await writeFile(configPath, yaml, { mode: 0o600 })
    return configPath
  }

  private authDir(): string {
    return path.join(this.ctx.paths.dataDir, 'state', 'auth')
  }

  private async accountFileCount(): Promise<number> {
    try {
      return (await readdir(this.authDir(), { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .length
    }
    catch {
      return 0
    }
  }

  private async health(config: CliProxyConfig): Promise<boolean> {
    const key = this.ctx.secrets.get(DATA_PLANE_SECRET_KEY)
    if (!key) { return false }
    try {
      const response = await fetch(`http://127.0.0.1:${config.port}/v1/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(1_500),
      })
      return response.ok
    }
    catch {
      return false
    }
  }

  private async waitUntilHealthy(config: CliProxyConfig): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (!this.processHandle?.status()) {
        throw new Error('CLIProxyAPI exited before becoming healthy.')
      }
      if (await this.health(config)) { return }
      await delay(HEALTH_RETRY_MS)
    }
    throw new Error(`CLIProxyAPI did not become healthy on 127.0.0.1:${config.port}.`)
  }

  async start(): Promise<CliProxySidecarStatus> {
    if (this.processHandle?.status()) { return await this.status() }
    const runtime = readRuntimeStatus({ dataDir: this.ctx.paths.dataDir })
    if (!runtime.installed || !runtime.executablePath) {
      throw new Error('Install the CLIProxyAPI runtime from Resources before starting it.')
    }
    const config = await this.readConfig()
    const configPath = await this.writeConfig(config)
    this.processHandle = await this.ctx.processes.spawn({
      id: 'sidecar',
      displayName: 'CLIProxyAPI sidecar',
      command: runtime.executablePath,
      args: ['-config', configPath],
      cwd: this.ctx.paths.dataDir,
    })
    try {
      await this.waitUntilHealthy(config)
      return await this.status()
    }
    catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<CliProxySidecarStatus> {
    await this.processHandle?.stop()
    this.processHandle = null
    return await this.status()
  }

  async login(provider: CliProxyAuthProvider): Promise<CliProxySidecarStatus> {
    const runtime = readRuntimeStatus({ dataDir: this.ctx.paths.dataDir })
    if (!runtime.installed || !runtime.executablePath) {
      throw new Error('Install the CLIProxyAPI runtime from Resources before adding an account.')
    }
    const processId = `auth-${provider}`
    if (this.ctx.processes.list().some(process => process.id === processId)) {
      throw new Error(`A ${provider} authentication flow is already running.`)
    }
    const configPath = await this.writeConfig(await this.readConfig())
    await this.ctx.processes.spawn({
      id: processId,
      displayName: `CLIProxyAPI ${provider} authentication`,
      command: runtime.executablePath,
      args: [AUTH_FLAGS[provider], '-config', configPath],
      cwd: this.ctx.paths.dataDir,
    })
    return await this.status()
  }

  async models(): Promise<string[]> {
    const config = await this.readConfig()
    const key = this.ctx.secrets.get(DATA_PLANE_SECRET_KEY)
    if (!key || !await this.health(config)) { return [] }
    try {
      const response = await fetch(`http://127.0.0.1:${config.port}/v1/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(3_000),
      })
      if (!response.ok) { return [] }
      return [...new Set(ModelListSchema.parse(await response.json()).data.map(model => model.id))].sort()
    }
    catch {
      return []
    }
  }

  async status(): Promise<CliProxySidecarStatus> {
    const runtime = readRuntimeStatus({ dataDir: this.ctx.paths.dataDir })
    const config = await this.readConfig()
    const running = this.processHandle?.status() !== null && this.processHandle !== null
    const healthy = running && await this.health(config)
    const authenticatingProviders = this.ctx.processes.list()
      .filter(process => process.id.startsWith('auth-'))
      .map(process => process.id.slice('auth-'.length))
      .sort()
    return {
      installed: runtime.installed,
      version: runtime.version,
      running,
      healthy,
      endpoint: `http://127.0.0.1:${config.port}/v1`,
      port: config.port,
      models: healthy ? await this.models() : [],
      accountFileCount: await this.accountFileCount(),
      authenticatingProviders,
      error: running && !healthy ? 'CLIProxyAPI is running but its health check is failing.' : null,
    }
  }

  dataPlaneKey(): string {
    return this.getOrCreateSecret(DATA_PLANE_SECRET_KEY)
  }

  async dispose(): Promise<void> {
    await this.stop()
  }
}
