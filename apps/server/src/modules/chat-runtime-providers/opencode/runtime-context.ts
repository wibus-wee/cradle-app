/**
 * Output: opencode SDK server host resource.
 * Input: opencode native config and Cradle runtime host key.
 * Position: opencode provider package runtime process owner.
 *
 * opencode `serve` is a stateless multiplexer: `directory` and `model` are
 * carried per request, while Cradle-owned provider/MCP config is injected at
 * process startup through `OPENCODE_CONFIG_CONTENT`. opencode cwd, config
 * directory, and database path are isolated under Cradle's runtime data
 * directory. One long-lived server serves every Cradle chat session and
 * workspace. Per-session process spawning and the host-manager lease/reaper
 * machinery do not apply here.
 *
 * The server is spawned through Cradle's managed-process runner (rather than
 * via the SDK's `createOpencode`) so Cradle retains the process owner and can
 * report pid/RSS/CPU to the Resource Panel and Grafana. The HTTP client is
 * still built with the SDK's `createOpencodeClient`.
 */

import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Config, OpencodeClient } from '@opencode-ai/sdk'
import { createOpencodeClient } from '@opencode-ai/sdk'
import type { OpencodeClient as OpencodeV2Client } from '@opencode-ai/sdk/v2'
import { createOpencodeClient as createOpencodeV2Client } from '@opencode-ai/sdk/v2'

import type { ManagedChildProcess } from '../../../infra/managed-process'
import { spawnManagedProcess } from '../../../infra/managed-process'
import { createChildLogger } from '../../../logging/logger'
import type { RuntimeLiveResourceLease } from '../../chat-runtime/runtime-provider-types'
import type { RuntimeKind } from '../../provider-contracts/types'
import { createDetachedProcessHostLease } from '../kit/process-host'

const logger = createChildLogger({ module: 'chat-runtime.opencode-server' })

const SERVER_STARTUP_TIMEOUT_MS = 5000
const SERVER_LISTENING_PATTERN = /on\s+(https?:\/\/\S+)/
const PROCESS_RESOURCE_FIELD_SEPARATOR_PATTERN = /\s+/
const OPENCODE_RUNTIME_DIR_NAME = 'opencode'
const OPENCODE_DB_FILE_NAME = 'opencode.db'
const OPENCODE_CONFIG_DIR_NAME = 'config'

export interface OpencodeRuntimeResource {
  client: OpencodeClient
  v2Client: OpencodeV2Client
  server: {
    url: string
    close: () => Promise<void>
  }
}

interface OpencodeServerInstance {
  client: OpencodeClient
  v2Client: OpencodeV2Client
  process: ManagedChildProcess
  url: string
  startedAt: number
  close: () => Promise<void>
}

interface OpencodeServerResources {
  running: boolean
  pid: number | null
  url: string | null
  startedAt: number | null
  uptimeSeconds: number | null
  rssMB: number | null
  cpuPercent: number | null
}

let instancePromise: Promise<OpencodeServerInstance> | null = null
let serverConfig: Config = {}
let serverConfigFingerprint = ''
const ignoredLateConfigFingerprints = new Set<string>()

/**
 * Start the shared opencode server (idempotent). Resolves to the same instance
 * for every caller. If startup fails the cached promise is cleared so the next
 * call retries instead of replaying the failure forever.
 */
export async function startOpencodeServer(): Promise<OpencodeServerInstance> {
  if (!instancePromise) {
    instancePromise = spawnOpencodeServerInstance().catch((error) => {
      instancePromise = null
      throw error
    })
  }
  return await instancePromise
}

/** Resolve the shared opencode server, starting it lazily if needed. */
export async function getOpencodeServer(): Promise<OpencodeServerInstance> {
  return await startOpencodeServer()
}

/** Stop the shared opencode server, if one is running. Safe to call when idle. */
export async function stopOpencodeServer(): Promise<void> {
  const pending = instancePromise
  instancePromise = null
  if (!pending) {
    return
  }
  try {
    const instance = await pending
    await instance.close()
    logger.info('opencode server stopped', { childPid: readManagedProcessPid(instance.process) })
  }
  catch (error) {
    logger.warn('opencode server stop failed', { error: formatError(error) })
  }
}

/**
 * Snapshot the shared opencode server process for the Resource Panel and
 * Grafana. RSS/CPU come from `ps` against the server pid (same approach as the
 * Chronicle daemon). When the server is not running, or `ps` is unavailable,
 * the resource fields degrade to `null` while still reporting `running`/`pid`.
 */
export function getOpencodeServerResources(): OpencodeServerResources {
  const instance = currentInstance()
  const pid = instance ? readManagedProcessPid(instance.process) : null
  if (!instance || !pid) {
    return {
      running: false,
      pid: null,
      url: null,
      startedAt: null,
      uptimeSeconds: null,
      rssMB: null,
      cpuPercent: null,
    }
  }

  const now = Date.now()
  const uptimeSeconds = Math.max(0, Math.floor((now - instance.startedAt) / 1000))
  const usage = readProcessResourceUsage(pid)
  return {
    running: true,
    pid,
    url: instance.url,
    startedAt: instance.startedAt,
    uptimeSeconds,
    rssMB: usage?.rssMB ?? null,
    cpuPercent: usage?.cpuPercent ?? null,
  }
}

function currentInstance(): OpencodeServerInstance | null {
  // The cached promise resolves to the live instance; if startup is still in
  // flight or has failed there is nothing to sample yet.
  if (!instancePromise) {
    return null
  }
  // The instance is only reachable synchronously once spawned. We peek via a
  // module-level slot updated when the process is born.
  return spawnedInstance
}

let spawnedInstance: OpencodeServerInstance | null = null

async function spawnOpencodeServerInstance(): Promise<OpencodeServerInstance> {
  const port = await findAvailablePort()
  const { process: proc, url } = await launchOpencodeServer(port)
  const client = createOpencodeClient({ baseUrl: url })
  const v2Client = createOpencodeV2Client({ baseUrl: url })
  const startedAt = Date.now()
  const instance: OpencodeServerInstance = {
    client,
    v2Client,
    process: proc,
    url,
    startedAt,
    close: () => stopProcess(proc),
  }
  spawnedInstance = instance
  proc.once('exit', (code, signal) => {
    logger.warn('opencode server exited', { childPid: readManagedProcessPid(proc), code, signal })
    if (spawnedInstance === instance) {
      spawnedInstance = null
      instancePromise = null
    }
  })
  logger.info('opencode server started', { url, port, childPid: readManagedProcessPid(proc) })
  return instance
}

function launchOpencodeServer(port: number): Promise<{ process: ManagedChildProcess, url: string }> {
  return new Promise((resolve, reject) => {
    const args = ['serve', `--hostname=127.0.0.1`, `--port=${port}`]
    const cwd = resolveOpencodeRuntimeDirectory()
    const configDir = resolveOpencodeConfigDirectory()
    const dbPath = resolveOpencodeDatabasePath()
    mkdirSync(cwd, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    const proc = spawnManagedProcess({
      kind: 'spawn',
      command: 'opencode',
      args,
      cwd,
      env: {
        ...process.env,
        OPENCODE_CONFIG_DIR: configDir,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(serverConfig),
        OPENCODE_DB: dbPath,
        OPENCODE_DISABLE_PROJECT_CONFIG: '1',
      },
      stdin: 'ignore',
      shutdownGraceMs: 3_000,
    })

    let output = ''
    let settled = false
    const startupTimeout = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      void stopProcess(proc)
      reject(new Error(`Timeout waiting for opencode server to start after ${SERVER_STARTUP_TIMEOUT_MS}ms`))
    }, SERVER_STARTUP_TIMEOUT_MS)

    const onLine = (line: string): void => {
      if (settled) {
        return
      }
      if (line.startsWith('opencode server listening')) {
        const match = line.match(SERVER_LISTENING_PATTERN)
        if (!match) {
          settled = true
          clearTimeout(startupTimeout)
          void stopProcess(proc)
          reject(new Error(`Failed to parse opencode server url from output: ${line}`))
          return
        }
        settled = true
        clearTimeout(startupTimeout)
        resolve({ process: proc, url: match[1] })
      }
    }

    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      for (const line of output.split('\n')) {
        onLine(line)
      }
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    proc.on('exit', (code, signal) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(startupTimeout)
      let message = `opencode server exited before listening (code ${code}, signal ${signal})`
      if (output.trim()) {
        message += `\nServer output: ${output.trim()}`
      }
      reject(new Error(message))
    })
    proc.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(startupTimeout)
      reject(error)
    })
  })
}

async function stopProcess(proc: ManagedChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return
  }
  await proc.stop('SIGTERM')
}

function readManagedProcessPid(proc: ManagedChildProcess): number | null {
  return proc.targetPid ?? proc.pid ?? null
}

function readProcessResourceUsage(pid: number): { rssMB: number, cpuPercent: number } | null {
  try {
    const output = execSync(`ps -o rss=,pcpu= -p ${pid}`, { encoding: 'utf8', timeout: 1000 }).trim()
    const [rssRaw, cpuRaw] = output.split(PROCESS_RESOURCE_FIELD_SEPARATOR_PATTERN)
    const rssMB = Number.parseInt(rssRaw, 10) / 1024
    const cpuPercent = Number.parseFloat(cpuRaw)
    if (!Number.isFinite(rssMB) || rssMB < 0 || !Number.isFinite(cpuPercent) || cpuPercent < 0) {
      return null
    }
    return {
      rssMB: Math.round(rssMB * 100) / 100,
      cpuPercent: Math.round(cpuPercent * 100) / 100,
    }
  }
  catch {
    return null
  }
}

/**
 * Add a Cradle provider target's opencode config to the shared server startup
 * config. We intentionally do not call opencode's config update endpoint with
 * the workspace directory: opencode persists that as a project-level
 * `config.json`, which would write runtime-owned Cradle config into the user's
 * source tree.
 *
 * Startup config can only be applied before the shared server is spawned.
 * Session acquire must not restart the global opencode host: opencode is a
 * runtime-owned server, and one chat session's resolved provider profile is not
 * allowed to mutate the lifecycle of every other session.
 */
export async function ensureOpencodeServerConfig(input: {
  config: Config
}): Promise<void> {
  const incomingConfig = readOpencodeRuntimeConfigPayload(input.config)
  if (!incomingConfig) {
    return
  }

  const nextConfig = mergeOpencodeRuntimeConfig(serverConfig, incomingConfig)
  const nextFingerprint = JSON.stringify(readOpencodeRuntimeConfigPayload(nextConfig) ?? {})
  if (serverConfigFingerprint === nextFingerprint) {
    return
  }

  if (instancePromise) {
    if (!ignoredLateConfigFingerprints.has(nextFingerprint)) {
      ignoredLateConfigFingerprints.add(nextFingerprint)
      logger.warn('opencode server startup config changed after shared server start; keeping server alive', {
        childPid: spawnedInstance ? readManagedProcessPid(spawnedInstance.process) : null,
      })
    }
    return
  }

  serverConfig = nextConfig
  serverConfigFingerprint = nextFingerprint
}

export function mergeOpencodeRuntimeConfig(base: Config, incoming: Config): Config {
  const merged: Config = { ...base }
  if (incoming.provider) {
    merged.provider = {
      ...(base.provider ?? {}),
      ...incoming.provider,
    }
  }
  if (incoming.mcp) {
    merged.mcp = {
      ...(base.mcp ?? {}),
      ...incoming.mcp,
    }
  }
  return merged
}

function readOpencodeRuntimeConfigPayload(config: Config): Pick<Config, 'provider' | 'mcp'> | null {
  const payload: Pick<Config, 'provider' | 'mcp'> = {}
  if (config.provider) {
    payload.provider = config.provider
  }
  if (config.mcp) {
    payload.mcp = config.mcp
  }
  return payload.provider || payload.mcp ? payload : null
}

/**
 * Acquire the shared opencode server resource. The returned lease is a no-op:
 * the server outlives every session, so `release()` does not tear anything
 * down. The signature is preserved so callers can keep treating it as a
 * host-managed lease.
 *
 * When the caller passes a config that projects `provider` or `mcp` entries,
 * it is used only if the shared server has not started yet. The workspace
 * directory remains only the request execution directory; Cradle disables
 * opencode project config and never writes runtime-owned opencode config into
 * it.
 */
export async function acquireOpencodeRuntimeResource(input: {
  runtimeKind: RuntimeKind
  providerTargetId: string
  chatSessionId: string
  config: Config
  directory?: string
}): Promise<RuntimeLiveResourceLease<OpencodeRuntimeResource>> {
  await ensureOpencodeServerConfig({ config: input.config })
  const instance = await getOpencodeServer()
  const resource: OpencodeRuntimeResource = {
    client: instance.client,
    v2Client: instance.v2Client,
    server: {
      url: instance.url,
      close: () => instance.close(),
    },
  }
  return createDetachedProcessHostLease(resource)
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate opencode server port')))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

export function resolveOpencodeRuntimeDirectory(): string {
  const dataDir = process.env.CRADLE_DATA_DIR?.trim()
  if (dataDir) {
    return join(dataDir, 'runtime', OPENCODE_RUNTIME_DIR_NAME)
  }
  return join(tmpdir(), 'cradle-runtime', OPENCODE_RUNTIME_DIR_NAME)
}

export function resolveOpencodeConfigDirectory(): string {
  return join(resolveOpencodeRuntimeDirectory(), OPENCODE_CONFIG_DIR_NAME)
}

export function resolveOpencodeDatabasePath(): string {
  return join(resolveOpencodeRuntimeDirectory(), OPENCODE_DB_FILE_NAME)
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return JSON.stringify(error)
}
