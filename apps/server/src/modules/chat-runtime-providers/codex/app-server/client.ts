import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import type { ManagedChildProcess } from '../../../../infra/managed-process'
import { spawnManagedProcess } from '../../../../infra/managed-process'
import type { ClientInfo } from '../app-server-protocol/ClientInfo'
import { syncCodexAppServerLogInsertBlockerFromFeatureFlag } from './log-insert-blocker'
import { prepareCodexAppServerHome } from './runtime-home'
import { isCodexAppServerInteractiveServerRequest } from './server-request-methods'

export { resolveCodexAppServerHome } from './runtime-home'

type RequestId = number
type CodexUserAgentMode = 'cradle' | 'native'

export interface CodexAppServerMessage {
  id?: RequestId
  method?: string
  params?: unknown
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface CodexAppServerServerRequest extends CodexAppServerMessage {
  id: RequestId
  method: string
}

export interface CodexAppServerClientOptions {
  codexPath?: string
  apiKey?: string
  config?: Record<string, unknown>
  env?: Record<string, string | undefined>
  userAgentMode?: CodexUserAgentMode
  serverRequestHandler?: (request: CodexAppServerServerRequest) => Promise<unknown> | unknown
  exposeServerRequestsAsNotifications?: boolean
}

const CODEX_NATIVE_CLIENT_INFO_FALLBACK_VERSION = '0.0.0'
const CODEX_APP_SERVER_PATH_ENV = 'CRADLE_CODEX_APP_SERVER_PATH'
const codexNativeClientVersionByPath = new Map<string, Promise<string>>()

export function buildCradleCodexAppServerEnv(input: {
  chatSessionId: string
  workspaceId?: string | null
  workspacePath?: string | null
  agentId?: string | null
  agentHome?: string | null
}): Record<string, string> {
  return Object.fromEntries(Object.entries({
    CRADLE_CHAT_SESSION_ID: input.chatSessionId,
    CRADLE_WORKSPACE_ID: input.workspaceId ?? undefined,
    CRADLE_WORKSPACE_PATH: input.workspacePath ?? undefined,
    CRADLE_AGENT_ID: input.agentId ?? undefined,
    CRADLE_AGENT_HOME: input.agentHome ?? undefined,
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

export class CodexAppServerClient {
  private readonly child: ManagedChildProcess
  private readonly childStdin: Writable
  private readonly pendingRequests = new Map<RequestId, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()

  private readonly notificationQueue: CodexAppServerMessage[] = []
  private readonly notificationWaiters: Array<(message: CodexAppServerMessage) => void> = []
  private readonly serverRequestHandler?: (request: CodexAppServerServerRequest) => Promise<unknown> | unknown
  private readonly exposeServerRequestsAsNotifications: boolean
  private readonly clientInfoVersion: string
  private readonly codexPath: string
  private readonly userAgentMode: CodexUserAgentMode
  private nextRequestId = 1
  private closed = false
  private stderrText = ''

  constructor(options: CodexAppServerClientOptions = {}) {
    this.serverRequestHandler = options.serverRequestHandler
    this.exposeServerRequestsAsNotifications = options.exposeServerRequestsAsNotifications ?? true
    const env = { ...process.env, ...options.env }
    const args = ['app-server', '--listen', 'stdio://']
    if (options.config) {
      for (const override of serializeConfigOverrides(options.config)) {
        args.push('--config', override)
      }
    }

    this.clientInfoVersion = readCradleCodexClientVersion(env)
    this.codexPath = options.codexPath ?? resolveCodexAppServerPath(env)
    this.userAgentMode = options.userAgentMode ?? 'cradle'
    env.CODEX_HOME = prepareCodexAppServerHome()
    syncCodexAppServerLogInsertBlockerFromFeatureFlag()
    if (options.apiKey) {
      env.CRADLE_CODEX_API_KEY = options.apiKey
      env.CODEX_API_KEY = options.apiKey
      env.OPENAI_API_KEY = options.apiKey
    }

    this.child = spawnManagedProcess({
      kind: 'spawn',
      command: this.codexPath,
      args,
      env,
      stdin: 'pipe',
      shutdownGraceMs: 5_000,
    })
    const childStdin = this.child.stdin
    const childStdout = this.child.stdout
    const childStderr = this.child.stderr
    if (!childStdin || !childStdout || !childStderr) {
      throw new Error('Codex app-server process did not expose stdio pipes')
    }
    this.childStdin = childStdin
    childStderr.on('data', (chunk: Buffer) => {
      this.stderrText += chunk.toString('utf8')
    })
    childStdin.on('error', error => this.terminate(error))
    this.child.once('error', error => this.terminate(error))
    this.child.once('exit', (code, signal) => this.terminate(this.createExitError(code, signal)))
    this.child.once('close', (code, signal) => this.terminate(this.createExitError(code, signal)))

    const lines = createInterface({ input: childStdout as Readable, crlfDelay: Infinity })
    lines.on('line', line => this.handleLine(line))
  }

  async initialize(): Promise<void> {
    const clientInfo = await this.readClientInfo()
    await this.request('initialize', {
      clientInfo,
      capabilities: { experimentalApi: true },
    })
    syncCodexAppServerLogInsertBlockerFromFeatureFlag()
  }

  private async readClientInfo(): Promise<ClientInfo> {
    if (this.userAgentMode === 'native') {
      return {
        name: 'codex',
        title: 'Codex',
        version: await readCodexNativeClientVersion(this.codexPath),
      }
    }
    return {
      name: 'cradle',
      title: 'Cradle',
      version: this.clientInfoVersion,
    }
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('Codex app-server is closed'))
    }
    const id = this.nextRequestId
    this.nextRequestId += 1
    const payload = params === undefined ? { id, method } : { id, method, params }
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.writeMessage(payload).catch((error) => {
        this.pendingRequests.delete(id)
        reject(error)
      })
    })
  }

  async nextNotification(signal?: AbortSignal): Promise<CodexAppServerMessage | null> {
    if (this.notificationQueue.length > 0) {
      return this.notificationQueue.shift() ?? null
    }
    if (this.closed) {
      return null
    }
    return new Promise((resolve, reject) => {
      let waiter: ((message: CodexAppServerMessage) => void) | null = null
      const onAbort = () => {
        const index = waiter ? this.notificationWaiters.indexOf(waiter) : -1
        if (index >= 0) {
          this.notificationWaiters.splice(index, 1)
        }
        reject(new Error('Codex app-server notification wait aborted'))
      }
      if (signal?.aborted) {
        reject(new Error('Codex app-server notification wait aborted'))
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      waiter = (message) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(message)
      }
      this.notificationWaiters.push(waiter)
    })
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    await this.child.stop('SIGTERM')
    this.terminate(new Error('Codex app-server closed'))
  }

  private createExitError(code: number | null, signal: NodeJS.Signals | null): Error {
    if (code === 0 && !signal) {
      return new Error('Codex app-server exited')
    }
    const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`
    return new Error(`Codex app-server exited with ${detail}: ${this.stderrText}`)
  }

  private terminate(error: Error): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.failAll(error)
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return
    }
    let message: CodexAppServerMessage
    try {
      message = JSON.parse(line) as CodexAppServerMessage
    }
    catch (error) {
      this.failAll(error instanceof Error ? error : new Error(String(error)))
      return
    }

    if (message.id !== undefined && message.method) {
      void this.handleServerRequest(message as CodexAppServerServerRequest)
      return
    }

    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id)
      if (!pending) {
        return
      }
      this.pendingRequests.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message))
      }
      else {
        pending.resolve(message.result)
      }
      return
    }

    this.pushNotification(message)
  }

  private async handleServerRequest(message: CodexAppServerServerRequest): Promise<void> {
    if (!this.serverRequestHandler) {
      await this.writeServerResponse({
        id: message.id,
        error: {
          code: -32601,
          message: `Cradle does not handle Codex app-server request: ${message.method}`,
        },
      })
      return
    }

    let response: CodexAppServerMessage
    try {
      if (this.exposeServerRequestsAsNotifications && isCodexAppServerInteractiveServerRequest(message.method)) {
        this.pushNotification({
          method: 'serverRequest/pending',
          params: {
            id: message.id,
            method: message.method,
            params: message.params,
          },
        })
      }
      const result = await this.serverRequestHandler(message)
      response = { id: message.id, result }
      if (this.exposeServerRequestsAsNotifications) {
        this.pushNotification({
          method: 'serverRequest/handled',
          params: {
            id: message.id,
            method: message.method,
            params: message.params,
            result,
          },
        })
      }
    }
    catch (error) {
      response = {
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }

    await this.writeServerResponse(response)
  }

  private pushNotification(message: CodexAppServerMessage): void {
    const waiter = this.notificationWaiters.shift()
    if (waiter) {
      waiter(message)
      return
    }
    this.notificationQueue.push(message)
  }

  private failAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
    while (this.notificationWaiters.length > 0) {
      this.notificationWaiters.shift()?.({ method: 'error', params: { message: error.message } })
    }
  }

  private writeServerResponse(payload: CodexAppServerMessage): Promise<void> {
    return this.writeMessage(payload).catch(() => undefined)
  }

  private writeMessage(payload: CodexAppServerMessage): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Codex app-server is closed'))
    }
    return new Promise((resolve, reject) => {
      try {
        this.childStdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (!error) {
            resolve()
            return
          }
          this.terminate(error)
          reject(error)
        })
      }
      catch (error) {
        const writeError = error instanceof Error ? error : new Error(String(error))
        this.terminate(writeError)
        reject(writeError)
      }
    })
  }
}

export function readCradleCodexClientVersion(env: Record<string, string | undefined> = process.env): string {
  return env.CRADLE_VERSION?.trim() || env.npm_package_version?.trim() || '0.0.1'
}

export function isCodexAppServerUnknownMethodError(error: unknown, method: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(`unknown variant \`${method}\``)
}

export function resolveCodexAppServerPath(env: Record<string, string | undefined> = process.env): string {
  return env[CODEX_APP_SERVER_PATH_ENV]?.trim() || 'codex'
}

export function readCodexNativeClientVersion(codexPath = 'codex'): Promise<string> {
  const cached = codexNativeClientVersionByPath.get(codexPath)
  if (cached) {
    return cached
  }

  const pending = new Promise<string>((resolve) => {
    let resolved = false
    let stdoutText = ''
    const child = spawn(codexPath, ['--version'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const finish = (version: string) => {
      if (resolved) {
        return
      }
      resolved = true
      clearTimeout(timer)
      resolve(version)
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(CODEX_NATIVE_CLIENT_INFO_FALLBACK_VERSION)
    }, 1500)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutText += chunk.toString('utf8')
    })
    child.once('error', () => {
      finish(CODEX_NATIVE_CLIENT_INFO_FALLBACK_VERSION)
    })
    child.once('close', () => {
      finish(readCodexVersionFromCliOutput(stdoutText))
    })
  })

  codexNativeClientVersionByPath.set(codexPath, pending)
  return pending
}

function readCodexVersionFromCliOutput(output: string): string {
  return output.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Z.-]+)?\b/i)?.[0]
    ?? CODEX_NATIVE_CLIENT_INFO_FALLBACK_VERSION
}

function serializeConfigOverrides(config: Record<string, unknown>, prefix = ''): string[] {
  const overrides: string[] = []
  for (const [key, value] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainRecord(value)) {
      overrides.push(...serializeConfigOverrides(value, path))
    }
    else {
      overrides.push(`${path}=${toTomlValue(value)}`)
    }
  }
  return overrides
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toTomlValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}
