/**
 * Output: cwd-scoped OpenCode SDK server resources.
 * Input: OpenCode binary path and workspace directory.
 * Position: OpenCode provider package runtime process owner.
 *
 * Each managed `opencode serve` process inherits the user's native OpenCode
 * config, auth, and project scope. Hosts are pooled by binary path and cwd so
 * sessions in the same workspace can share a process without crossing project
 * boundaries. A host remains warm for a short idle period after its final
 * lease is released.
 */

import { execFileSync } from 'node:child_process'
import net from 'node:net'

import type { Config, OpencodeClient } from '@opencode-ai/sdk'
import { createOpencodeClient } from '@opencode-ai/sdk'
import type { OpencodeClient as OpencodeV2Client } from '@opencode-ai/sdk/v2'
import { createOpencodeClient as createOpencodeV2Client } from '@opencode-ai/sdk/v2'

import type { ManagedChildProcess, ManagedSpawnOptions } from '../../../infra/managed-process'
import { spawnManagedProcess } from '../../../infra/managed-process'
import { createChildLogger } from '../../../logging/logger'
import type { RuntimeLiveResourceLease } from '../../chat-runtime/runtime-provider-types'
import type { RuntimeKind } from '../../provider-contracts/types'

const logger = createChildLogger({ module: 'chat-runtime.opencode-server' })

const DEFAULT_SERVER_STARTUP_TIMEOUT_MS = 10_000
const DEFAULT_SERVER_IDLE_TTL_MS = 5 * 60 * 1000
const SERVER_LISTENING_PATTERN = /on\s+(https?:\/\/\S+)/
const PROCESS_RESOURCE_FIELD_SEPARATOR_PATTERN = /\s+/

export interface OpencodeRuntimeResource {
  client: OpencodeClient
  v2Client: OpencodeV2Client
  server: {
    url: string
    close: () => Promise<void>
  }
}

export interface OpencodeManagedHost {
  resource: OpencodeRuntimeResource
  process: ManagedChildProcess
  url: string
  binaryPath: string
  cwd: string
  startedAt: number
  close: () => Promise<void>
}

interface OpencodePoolEntry {
  key: string
  binaryPath: string
  cwd: string
  refCount: number
  hostPromise: Promise<OpencodeManagedHost>
  host: OpencodeManagedHost | null
  idleTimer: ReturnType<typeof setTimeout> | null
}

export interface OpencodeRuntimePoolOptions {
  idleTtlMs?: number
  startupTimeoutMs?: number
  startHost?: (input: {
    binaryPath: string
    cwd: string
    startupTimeoutMs: number
    onExit: (code: number | null, signal: NodeJS.Signals | null) => void
  }) => Promise<OpencodeManagedHost>
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

export class OpencodeRuntimePool {
  private readonly entries = new Map<string, OpencodePoolEntry>()
  private readonly entriesByResource = new WeakMap<OpencodeRuntimeResource, OpencodePoolEntry>()
  private readonly idleTtlMs: number
  private readonly startupTimeoutMs: number
  private readonly startHost: NonNullable<OpencodeRuntimePoolOptions['startHost']>

  constructor(options: OpencodeRuntimePoolOptions = {}) {
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_SERVER_IDLE_TTL_MS
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_SERVER_STARTUP_TIMEOUT_MS
    this.startHost = options.startHost ?? startManagedOpencodeHost
  }

  async acquire(input: {
    binaryPath?: string
    directory?: string
  }): Promise<RuntimeLiveResourceLease<OpencodeRuntimeResource>> {
    const { binaryPath, cwd } = resolveOpencodeRuntimeHostOptions(input)
    const key = opencodePoolKey(binaryPath, cwd)
    let entry = this.entries.get(key)

    if (entry) {
      this.cancelIdleClose(entry)
      entry.refCount += 1
    }
    else {
      entry = this.createEntry({ key, binaryPath, cwd })
      this.entries.set(key, entry)
    }

    try {
      const host = await entry.hostPromise
      return this.createLease(entry, host.resource)
    }
    catch (error) {
      if (this.entries.get(key) === entry) {
        this.entries.delete(key)
      }
      throw error
    }
  }

  retain(resource: OpencodeRuntimeResource): RuntimeLiveResourceLease<OpencodeRuntimeResource> {
    const entry = this.entriesByResource.get(resource)
    if (!entry || this.entries.get(entry.key) !== entry || !entry.host) {
      throw new Error('OpenCode runtime resource is no longer active.')
    }
    this.cancelIdleClose(entry)
    entry.refCount += 1
    return this.createLease(entry, resource)
  }

  getResources(): OpencodeServerResources {
    const host = Array.from(this.entries.values(), entry => entry.host).find(candidate => candidate !== null)
    const pid = host ? readManagedProcessPid(host.process) : null
    if (!host || !pid) {
      return emptyOpencodeServerResources()
    }

    const usage = readProcessResourceUsage(pid)
    return {
      running: true,
      pid,
      url: host.url,
      startedAt: host.startedAt,
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - host.startedAt) / 1000)),
      rssMB: usage?.rssMB ?? null,
      cpuPercent: usage?.cpuPercent ?? null,
    }
  }

  async shutdown(): Promise<void> {
    const entries = Array.from(this.entries.values())
    this.entries.clear()
    await Promise.allSettled(entries.map(entry => this.closeEntry(entry)))
  }

  private createEntry(input: {
    key: string
    binaryPath: string
    cwd: string
  }): OpencodePoolEntry {
    const entry: OpencodePoolEntry = {
      ...input,
      refCount: 1,
      hostPromise: Promise.resolve(null as never),
      host: null,
      idleTimer: null,
    }
    entry.hostPromise = this.startHost({
      binaryPath: input.binaryPath,
      cwd: input.cwd,
      startupTimeoutMs: this.startupTimeoutMs,
      onExit: (code, signal) => this.handleHostExit(entry, code, signal),
    }).then(async (host) => {
      if (this.entries.get(input.key) !== entry) {
        await host.close()
        throw new Error(`OpenCode runtime host was closed before startup completed: ${input.cwd}`)
      }
      entry.host = host
      this.entriesByResource.set(host.resource, entry)
      return host
    })
    return entry
  }

  private createLease(
    entry: OpencodePoolEntry,
    resource: OpencodeRuntimeResource,
  ): RuntimeLiveResourceLease<OpencodeRuntimeResource> {
    let released = false
    return {
      resource,
      refresh: () => {
        if (!released) {
          this.cancelIdleClose(entry)
        }
      },
      release: () => {
        if (released) {
          return
        }
        released = true
        this.releaseEntry(entry)
      },
    }
  }

  private releaseEntry(entry: OpencodePoolEntry): void {
    if (this.entries.get(entry.key) !== entry) {
      return
    }
    entry.refCount = Math.max(0, entry.refCount - 1)
    if (entry.refCount !== 0) {
      return
    }
    this.cancelIdleClose(entry)
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null
      if (this.entries.get(entry.key) !== entry || entry.refCount !== 0) {
        return
      }
      this.entries.delete(entry.key)
      void this.closeEntry(entry)
    }, this.idleTtlMs)
    entry.idleTimer.unref?.()
  }

  private cancelIdleClose(entry: OpencodePoolEntry): void {
    if (!entry.idleTimer) {
      return
    }
    clearTimeout(entry.idleTimer)
    entry.idleTimer = null
  }

  private handleHostExit(
    entry: OpencodePoolEntry,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.entries.get(entry.key) !== entry) {
      return
    }
    this.entries.delete(entry.key)
    this.cancelIdleClose(entry)
    entry.refCount = 0
    logger.warn('opencode server exited', {
      binaryPath: entry.binaryPath,
      cwd: entry.cwd,
      childPid: entry.host ? readManagedProcessPid(entry.host.process) : null,
      code,
      signal,
    })
  }

  private async closeEntry(entry: OpencodePoolEntry): Promise<void> {
    this.cancelIdleClose(entry)
    entry.refCount = 0
    try {
      const host = entry.host ?? await entry.hostPromise
      await host.close()
    }
    catch (error) {
      logger.warn('opencode server stop failed', {
        binaryPath: entry.binaryPath,
        cwd: entry.cwd,
        error: formatError(error),
      })
    }
  }
}

const opencodeRuntimePool = new OpencodeRuntimePool()

export function resolveOpencodeBinaryPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.CRADLE_OPENCODE_PATH?.trim() || 'opencode'
}

export function resolveOpencodeRuntimeHostOptions(input: {
  binaryPath?: string
  directory?: string
} = {}): { binaryPath: string, cwd: string } {
  return {
    binaryPath: input.binaryPath?.trim() || resolveOpencodeBinaryPath(),
    cwd: input.directory?.trim() || process.cwd(),
  }
}

export async function acquireOpencodeRuntimeResource(input: {
  runtimeKind: RuntimeKind
  providerTargetId: string
  chatSessionId: string
  config: Config
  directory?: string
  binaryPath?: string
}): Promise<RuntimeLiveResourceLease<OpencodeRuntimeResource>> {
  return await opencodeRuntimePool.acquire({
    directory: input.directory,
    binaryPath: input.binaryPath,
  })
}

export function tryRetainOpencodeRuntimeResource(
  resource: OpencodeRuntimeResource,
): RuntimeLiveResourceLease<OpencodeRuntimeResource> | null {
  try {
    return opencodeRuntimePool.retain(resource)
  }
  catch {
    return null
  }
}

/** Stop all cwd-scoped OpenCode hosts. Safe to call when the pool is empty. */
export async function stopOpencodeServer(): Promise<void> {
  await opencodeRuntimePool.shutdown()
}

/** Return the first live cwd-scoped host for the existing resource panel shape. */
export function getOpencodeServerResources(): OpencodeServerResources {
  return opencodeRuntimePool.getResources()
}

async function startManagedOpencodeHost(input: {
  binaryPath: string
  cwd: string
  startupTimeoutMs: number
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void
}): Promise<OpencodeManagedHost> {
  const port = await findAvailablePort()
  const { process: proc, url } = await launchOpencodeServer({
    binaryPath: input.binaryPath,
    cwd: input.cwd,
    port,
    startupTimeoutMs: input.startupTimeoutMs,
  })
  const client = createOpencodeClient({ baseUrl: url, directory: input.cwd })
  const v2Client = createOpencodeV2Client({ baseUrl: url, directory: input.cwd })
  const startedAt = Date.now()
  const close = () => stopProcess(proc)
  const resource: OpencodeRuntimeResource = {
    client,
    v2Client,
    server: { url, close },
  }

  proc.once('exit', input.onExit)
  logger.info('opencode server started', {
    binaryPath: input.binaryPath,
    cwd: input.cwd,
    url,
    port,
    childPid: readManagedProcessPid(proc),
  })
  return {
    resource,
    process: proc,
    url,
    binaryPath: input.binaryPath,
    cwd: input.cwd,
    startedAt,
    close,
  }
}

function launchOpencodeServer(input: {
  binaryPath: string
  cwd: string
  port: number
  startupTimeoutMs: number
}): Promise<{ process: ManagedChildProcess, url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawnManagedProcess(createOpencodeServerProcessOptions(input))

    let stdout = ''
    let stderr = ''
    let settled = false
    const startupTimeout = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      void stopProcess(proc).catch(() => undefined)
      reject(new Error(formatStartupError({
        summary: `Timed out waiting for OpenCode server startup after ${input.startupTimeoutMs}ms.`,
        stdout,
        stderr,
      })))
    }, input.startupTimeoutMs)
    startupTimeout.unref?.()

    const finishWithError = (error: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(startupTimeout)
      reject(error)
    }
    const readReadyUrl = (): void => {
      if (settled) {
        return
      }
      for (const line of stdout.split('\n')) {
        if (!line.startsWith('opencode server listening')) {
          continue
        }
        const url = line.match(SERVER_LISTENING_PATTERN)?.[1]
        if (!url) {
          void stopProcess(proc).catch(() => undefined)
          finishWithError(new Error(`Failed to parse OpenCode server URL from output: ${line}`))
          return
        }
        settled = true
        clearTimeout(startupTimeout)
        resolve({ process: proc, url })
        return
      }
    }

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      readReadyUrl()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.once('exit', (code, signal) => {
      finishWithError(new Error(formatStartupError({
        summary: `OpenCode server exited before listening (code ${code}, signal ${signal}).`,
        stdout,
        stderr,
      })))
    })
    proc.once('error', finishWithError)
  })
}

export function createOpencodeServerProcessOptions(input: {
  binaryPath: string
  cwd: string
  port: number
}): ManagedSpawnOptions {
  return {
    kind: 'spawn',
    command: input.binaryPath,
    args: ['serve', '--hostname=127.0.0.1', `--port=${input.port}`],
    cwd: input.cwd,
    stdin: 'ignore',
    shutdownGraceMs: 3_000,
  }
}

async function stopProcess(proc: ManagedChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return
  }
  await proc.stop('SIGTERM')
}

function opencodePoolKey(binaryPath: string, cwd: string): string {
  return JSON.stringify({ binaryPath, cwd })
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate OpenCode server port.')))
        return
      }
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

function readManagedProcessPid(proc: ManagedChildProcess): number | null {
  return proc.targetPid ?? proc.pid ?? null
}

function readProcessResourceUsage(pid: number): { rssMB: number, cpuPercent: number } | null {
  try {
    const output = execFileSync('ps', ['-o', 'rss=,pcpu=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1000,
    }).trim()
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

function emptyOpencodeServerResources(): OpencodeServerResources {
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

function formatStartupError(input: {
  summary: string
  stdout: string
  stderr: string
}): string {
  const stdout = input.stdout.trim()
  const stderr = input.stderr.trim()
  return [
    input.summary,
    stdout ? `stdout:\n${stdout}` : 'stdout: <empty>',
    stderr ? `stderr:\n${stderr}` : 'stderr: <empty>',
  ].join('\n\n')
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
