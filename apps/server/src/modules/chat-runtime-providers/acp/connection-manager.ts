import { promises as fsp } from 'node:fs'

import type {
  ClientConnection,
  ClientContext,
  InitializeResponse,
  LoadSessionResponse,
  McpServer,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ResumeSessionResponse,
  SessionConfigOption,
  SessionModeState,
  SessionNotification,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  StopReason,
} from '@agentclientprotocol/sdk'
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from '@agentclientprotocol/sdk'
import type { UIMessageChunk } from 'ai'

import packageJson from '../../../../package.json'
import { getRegisteredStdioMcpServers } from '../../../plugins/mcp-registry'
import type { ProviderAuthMethod, ProviderKind, RuntimeKind } from '../../chat-runtime/runtime-provider-types'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import { providerChunk } from '../kit/chunk-mapper'
import { projectAcpAuthMethods } from './auth'
import type { AcpConnectionRecord } from './config'
import { ACP_RUNTIME_KIND } from './metadata'
import type { AcpProcessHost } from './process-manager'
import { AcpChunkMapper } from './timeline-mapper'

const DEFAULT_REQUEST_TIMEOUTS = {
  metadataMs: 30_000,
  authenticateMs: 300_000,
  promptMs: 600_000,
} as const

export interface AcpRequestTimeouts {
  metadataMs: number
  authenticateMs: number
  promptMs: number
}

export interface AcpConnectionManagerOptions {
  readSecret?: (secretRef: string) => string
  requestTimeouts?: Partial<AcpRequestTimeouts>
}

export interface AcpSessionState {
  modes: SessionModeState | null
  configOptions: SessionConfigOption[]
}

export interface AcpPromptRuntimeContext {
  chatSessionId: string
  runId: string
  providerKind: ProviderKind
  runtimeKind: RuntimeKind
}

export interface AcpPermissionRequest {
  agentId: string
  sessionId: string
  providerMethod: string
  toolTitle: string
  options: Array<{ optionId: string, name: string, kind: string }>
  runtimeContext?: AcpPromptRuntimeContext
}

export interface AcpPermissionResponse {
  outcome: 'selected' | 'cancelled'
  optionId?: string
}

export type AcpPermissionHandler = (request: AcpPermissionRequest) => Promise<AcpPermissionResponse>

export function listRegisteredAcpMcpServers(chatSessionId?: string): McpServer[] {
  return Object.entries(getRegisteredStdioMcpServers(
    chatSessionId ? { chatSessionId } : undefined,
  )).map(([name, config]) => ({
    name,
    command: config.command,
    args: config.args,
    env: Object.entries(config.env).map(([envName, value]) => ({ name: envName, value })),
  }))
}

class ChunkQueue {
  private buffered: UIMessageChunk[] = []
  private waiters: Array<{
    resolve: (value: UIMessageChunk | null) => void
    reject: (error: Error) => void
  }> = []

  private closed = false
  private failure: Error | null = null

  push(chunk: UIMessageChunk): void {
    if (this.closed) {
      return
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve(chunk)
      return
    }
    this.buffered.push(chunk)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()!.resolve(null)
    }
  }

  fail(error: Error): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.failure = error
    while (this.waiters.length > 0) {
      this.waiters.shift()!.reject(error)
    }
  }

  async next(): Promise<UIMessageChunk | null> {
    if (this.buffered.length > 0) {
      return this.buffered.shift()!
    }
    if (this.failure) {
      throw this.failure
    }
    if (this.closed) {
      return null
    }
    return new Promise<UIMessageChunk | null>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }
}

interface SessionChannel {
  mapper: AcpChunkMapper
  queue: ChunkQueue
  promptAbortController: AbortController
  closedBy: { kind: 'cancelled' } | { kind: 'disconnected', error: Error } | null
}

interface ConnectionEntry {
  agentId: string
  connection: ClientConnection
  agent: ClientContext
  initResult: InitializeResponse | null
  sessionStates: Map<string, AcpSessionState>
  channels: Map<string, SessionChannel>
  restoringSessionLoads: Set<string>
  authenticatedMethodId: string | null
}

export class AcpConnectionManager {
  private readonly connections = new Map<string, ConnectionEntry>()
  private readonly pendingConnects = new Map<string, Promise<InitializeResponse>>()
  private readonly sessionTitleHandlers = new Set<(acpSessionId: string, title: string) => void>()
  private readonly usageBySessionKey = new Map<string, TokenUsage | null>()
  private readonly promptRuntimeContexts = new Map<string, AcpPromptRuntimeContext>()
  private readonly readSecret: (secretRef: string) => string
  private readonly requestTimeouts: AcpRequestTimeouts
  private permissionHandler: AcpPermissionHandler | null = null

  constructor(
    private readonly processManager: AcpProcessHost,
    options: AcpConnectionManagerOptions = {},
  ) {
    this.readSecret = options.readSecret ?? (() => {
      throw new Error('ACP authentication requires a Secrets-owned credential resolver')
    })
    this.requestTimeouts = {
      ...DEFAULT_REQUEST_TIMEOUTS,
      ...options.requestTimeouts,
    }
  }

  setPermissionHandler(handler: AcpPermissionHandler): void {
    this.permissionHandler = handler
  }

  onSessionTitle(handler: (acpSessionId: string, title: string) => void): () => void {
    this.sessionTitleHandlers.add(handler)
    return () => {
      this.sessionTitleHandlers.delete(handler)
    }
  }

  async connect(agentId: string, record: AcpConnectionRecord): Promise<InitializeResponse> {
    if (this.connections.has(agentId)) {
      throw new Error(`Agent ${agentId} is already connected`)
    }

    const pending = this.pendingConnects.get(agentId)
    if (pending) {
      return pending
    }

    const promise = this.openConnection(agentId, record).finally(() => {
      this.pendingConnects.delete(agentId)
    })
    this.pendingConnects.set(agentId, promise)
    return promise
  }

  async newSession(agentId: string, cwd: string, chatSessionId?: string): Promise<NewSessionResponse & AcpSessionState> {
    const conn = this.getConnection(agentId)
    const response = await this.requestWithDeadline({
      conn,
      operation: methods.agent.session.new,
      timeoutMs: this.requestTimeouts.metadataMs,
      request: signal => conn.agent.request(methods.agent.session.new, {
        cwd,
        mcpServers: listRegisteredAcpMcpServers(chatSessionId),
      }, { cancellationSignal: signal }),
    })
    const sessionState = readAcpSessionState(response)
    this.cacheSessionState(conn, response.sessionId, sessionState)
    return { ...response, modes: sessionState.modes, configOptions: sessionState.configOptions }
  }

  supportsLoadSession(agentId: string): boolean {
    return !!this.getConnection(agentId).initResult?.agentCapabilities?.loadSession
  }

  supportsResumeSession(agentId: string): boolean {
    return !!this.getConnection(agentId).initResult?.agentCapabilities?.sessionCapabilities?.resume
  }

  getAuthMethods(agentId: string): ProviderAuthMethod[] {
    return projectAcpAuthMethods(this.getConnection(agentId).initResult?.authMethods ?? [])
  }

  async loadSession(agentId: string, sessionId: string, cwd: string, chatSessionId?: string): Promise<LoadSessionResponse & AcpSessionState> {
    const conn = this.getConnection(agentId)
    if (!this.supportsLoadSession(agentId)) {
      throw new Error(`Agent ${agentId} does not support session/load`)
    }

    conn.restoringSessionLoads.add(sessionId)
    try {
      const response = await this.requestWithDeadline({
        conn,
        operation: methods.agent.session.load,
        sessionId,
        timeoutMs: this.requestTimeouts.metadataMs,
        request: signal => conn.agent.request(methods.agent.session.load, {
          sessionId,
          cwd,
          mcpServers: listRegisteredAcpMcpServers(chatSessionId),
        }, { cancellationSignal: signal }),
      })
      const sessionState = readAcpSessionState(response)
      this.cacheSessionState(conn, sessionId, sessionState)
      return { ...response, modes: sessionState.modes, configOptions: sessionState.configOptions }
    }
    finally {
      conn.restoringSessionLoads.delete(sessionId)
    }
  }

  async resumeSession(agentId: string, sessionId: string, cwd: string, chatSessionId?: string): Promise<ResumeSessionResponse & AcpSessionState> {
    const conn = this.getConnection(agentId)
    if (!this.supportsResumeSession(agentId)) {
      throw new Error(`Agent ${agentId} does not support session/resume`)
    }

    const response = await this.requestWithDeadline({
      conn,
      operation: methods.agent.session.resume,
      sessionId,
      timeoutMs: this.requestTimeouts.metadataMs,
      request: signal => conn.agent.request(methods.agent.session.resume, {
        sessionId,
        cwd,
        mcpServers: listRegisteredAcpMcpServers(chatSessionId),
      }, { cancellationSignal: signal }),
    })
    const sessionState = readAcpSessionState(response)
    this.cacheSessionState(conn, sessionId, sessionState)
    return { ...response, modes: sessionState.modes, configOptions: sessionState.configOptions }
  }

  getSessionState(agentId: string, sessionId: string): AcpSessionState | null {
    return this.connections.get(agentId)?.sessionStates.get(sessionId) ?? null
  }

  async setSessionModel(agentId: string, sessionId: string, modelId: string): Promise<void> {
    const conn = this.getConnection(agentId)
    const state = conn.sessionStates.get(sessionId)
    if (!state) {
      throw new Error(`ACP session ${sessionId} does not have cached session configuration`)
    }
    const modelOption = state.configOptions.find(isModelConfigOption)
    if (!modelOption || !hasConfigValue(modelOption, modelId)) {
      throw new Error(`ACP session ${sessionId} does not expose model ${modelId} as a session config option`)
    }

    const response = await this.requestWithDeadline({
      conn,
      operation: methods.agent.session.setConfigOption,
      sessionId,
      timeoutMs: this.requestTimeouts.metadataMs,
      request: signal => this.requestSessionConfigOption(conn.agent, {
        sessionId,
        configId: modelOption.id,
        value: modelId,
      }, signal),
    })
    state.configOptions = response.configOptions
  }

  async setSessionConfigOption(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void> {
    const conn = this.getConnection(agentId)
    const params: SetSessionConfigOptionRequest = { sessionId, configId, ...formatSessionConfigOptionValue(value) }
    const response = await this.requestWithDeadline({
      conn,
      operation: methods.agent.session.setConfigOption,
      sessionId,
      timeoutMs: this.requestTimeouts.metadataMs,
      request: signal => this.requestSessionConfigOption(conn.agent, params, signal),
    })
    const state = conn.sessionStates.get(sessionId)
    if (state && response?.configOptions) {
      state.configOptions = response.configOptions
    }
  }

  async* prompt(
    agentId: string,
    sessionId: string,
    message: string,
    runtimeContext?: AcpPromptRuntimeContext,
  ): AsyncGenerator<UIMessageChunk, void, void> {
    const conn = this.getConnection(agentId)
    if (conn.channels.has(sessionId)) {
      throw new ProviderRuntimeError(ProviderErrors.requestFailed(
        ACP_RUNTIME_KIND,
        methods.agent.session.prompt,
        `ACP connection ${agentId} already has an active prompt for session ${sessionId}`,
      ))
    }

    const mapper = new AcpChunkMapper()
    const queue = new ChunkQueue()
    const promptAbortController = new AbortController()
    const channel: SessionChannel = { mapper, queue, promptAbortController, closedBy: null }
    conn.channels.set(sessionId, channel)

    const usageKey = toUsageKey(agentId, sessionId)
    this.usageBySessionKey.delete(usageKey)
    if (runtimeContext) {
      this.promptRuntimeContexts.set(usageKey, runtimeContext)
    }

    let promptError: Error | null = null

    const promptDone = this.requestWithDeadline({
      conn,
      operation: methods.agent.session.prompt,
      sessionId,
      timeoutMs: this.requestTimeouts.promptMs,
      abortController: promptAbortController,
      request: signal => conn.agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text: message }],
      }, { cancellationSignal: signal }),
    })
      .then((result) => {
        if (channel.closedBy) {
          return
        }
        this.usageBySessionKey.set(usageKey, toTokenUsage(result))
        for (const event of mapper.flush()) {
          queue.push(event)
        }
        queue.push(providerChunk.finish(mapAcpStopReason(result.stopReason)))
        queue.close()
      })
      .catch((error: unknown) => {
        promptError = error instanceof Error ? error : new Error(String(error))
        if (channel.closedBy) {
          return
        }
        for (const event of mapper.flush()) {
          queue.push(event)
        }
        queue.fail(promptError)
      })
      .finally(() => {
        if (conn.channels.get(sessionId) === channel) {
          conn.channels.delete(sessionId)
        }
      })

    try {
      while (true) {
        const chunk = await queue.next()
        if (chunk === null) {
          break
        }
        yield chunk
      }

      if (channel.closedBy?.kind === 'cancelled') {
        this.usageBySessionKey.delete(usageKey)
        return
      }

      if (channel.closedBy?.kind === 'disconnected') {
        this.usageBySessionKey.delete(usageKey)
        throw channel.closedBy.error
      }

      await promptDone
      if (promptError) {
        throw promptError
      }
    }
    catch (error) {
      if (!channel.closedBy) {
        await promptDone.catch(() => {})
      }
      throw error
    }
    finally {
      if (runtimeContext && this.promptRuntimeContexts.get(usageKey) === runtimeContext) {
        this.promptRuntimeContexts.delete(usageKey)
      }
    }
  }

  getLastUsage(agentId: string, sessionId: string): TokenUsage | null {
    return this.usageBySessionKey.get(toUsageKey(agentId, sessionId)) ?? null
  }

  async cancel(agentId: string, sessionId: string): Promise<void> {
    const conn = this.getConnection(agentId)
    const channel = conn.channels.get(sessionId)
    this.closeChannel(conn, sessionId, { kind: 'cancelled' })
    channel?.promptAbortController.abort()
    this.usageBySessionKey.delete(toUsageKey(agentId, sessionId))
    await conn.agent.notify(methods.agent.session.cancel, { sessionId })
  }

  async disconnect(agentId: string): Promise<void> {
    const conn = this.connections.get(agentId)
    if (conn) {
      this.failConnectionChannels(conn, new Error(`ACP agent disconnected: ${agentId}`))
      this.connections.delete(agentId)
      conn.connection.close()
    }
    for (const key of [...this.usageBySessionKey.keys()]) {
      if (key.startsWith(`${agentId}:`)) {
        this.usageBySessionKey.delete(key)
      }
    }
    await this.processManager.stop(agentId)
  }

  isConnected(agentId: string): boolean {
    return this.connections.has(agentId)
  }

  getMetrics() {
    return this.processManager.getMetrics()
  }

  private async openConnection(agentId: string, record: AcpConnectionRecord): Promise<InitializeResponse> {
    const authSecretRefs = record.authSecretRefs ?? {}
    let entry = await this.openInitializedConnection(
      agentId,
      record,
      {},
      Object.keys(authSecretRefs),
    )
    try {
      const selectedMethodId = record.authMethodId
      if (selectedMethodId) {
        const selected = this.requireSelectedAuthMethod(entry, selectedMethodId, authSecretRefs)
        if (selected.kind === 'env_var') {
          await this.closeUnpublishedConnection(entry)
          const authEnv = this.resolveAuthEnvironment(authSecretRefs)
          entry = await this.openInitializedConnection(agentId, record, authEnv)
          const restartedMethod = this.requireSelectedAuthMethod(entry, selectedMethodId, authSecretRefs)
          if (restartedMethod.kind !== 'env_var') {
            throw new ProviderRuntimeError(ProviderErrors.authRequired(
              ACP_RUNTIME_KIND,
              projectAcpAuthMethods(entry.initResult?.authMethods ?? []),
            ))
          }
        }

        try {
          await this.requestWithDeadline({
            conn: entry,
            operation: methods.agent.authenticate,
            timeoutMs: this.requestTimeouts.authenticateMs,
            mapAuthRequired: false,
            request: signal => entry.agent.request(
              methods.agent.authenticate,
              { methodId: selectedMethodId },
              { cancellationSignal: signal },
            ),
          })
        }
        catch (error) {
          throw new ProviderRuntimeError(ProviderErrors.authFailed(ACP_RUNTIME_KIND), { cause: error })
        }
        entry.authenticatedMethodId = selectedMethodId
      }

      this.publishConnection(entry)
      return entry.initResult!
    }
    catch (error) {
      await this.closeUnpublishedConnection(entry)
      throw error
    }
  }

  private async openInitializedConnection(
    agentId: string,
    record: AcpConnectionRecord,
    authEnv: Record<string, string>,
    excludedEnvNames: readonly string[] = [],
  ): Promise<ConnectionEntry> {
    const args = JSON.parse(record.args) as string[]
    const env = JSON.parse(record.env) as Record<string, string>
    const excludedEnv = new Set(excludedEnvNames)
    const launchEnv = Object.fromEntries(
      Object.entries(env).filter(([name]) => !excludedEnv.has(name)),
    )
    let connection: ClientConnection | null = null
    try {
      const procEntry = this.processManager.spawn({
        agentId,
        cmd: record.cmd,
        args,
        env: { ...launchEnv, ...authEnv },
        sensitiveEnvNames: Object.keys(authEnv),
        distributionType: record.distributionType,
        installPath: record.installPath,
      })

      connection = client({ name: 'Cradle Server' })
        .onRequest(methods.client.session.requestPermission, async ({ params }) => this.handlePermissionRequest(agentId, params))
        .onNotification(methods.client.session.update, async ({ params }) => {
          this.handleSessionUpdate(agentId, params)
        })
        .onRequest(methods.client.fs.readTextFile, async ({ params }) => this.readClientTextFile(params.path, params.line, params.limit))
        .onRequest(methods.client.fs.writeTextFile, async ({ params }) => {
          await this.requestClientFileWriteApproval(agentId, params.sessionId, params.path)
          await fsp.writeFile(params.path, params.content, 'utf-8')
          return {}
        })
        .connect(ndJsonStream(procEntry.stdinWeb, procEntry.stdoutWeb))

      const entry: ConnectionEntry = {
        agentId,
        connection,
        agent: connection.agent,
        initResult: null,
        sessionStates: new Map(),
        channels: new Map(),
        restoringSessionLoads: new Set(),
        authenticatedMethodId: null,
      }
      const initResult = await this.requestWithDeadline({
        conn: entry,
        operation: methods.agent.initialize,
        timeoutMs: this.requestTimeouts.metadataMs,
        mapAuthRequired: false,
        request: signal => entry.agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: 'Cradle Server', version: packageJson.version },
          clientCapabilities: {
            fs: {
              readTextFile: true,
              writeTextFile: true,
            },
          },
        }, { cancellationSignal: signal }),
      })
      entry.initResult = initResult

      if (initResult.protocolVersion !== PROTOCOL_VERSION) {
        throw new ProviderRuntimeError(ProviderErrors.requestFailed(
          ACP_RUNTIME_KIND,
          methods.agent.initialize,
          `ACP protocol version mismatch: requested ${PROTOCOL_VERSION}, received ${initResult.protocolVersion}`,
        ))
      }

      return entry
    }
    catch (error) {
      connection?.close(error)
      await this.processManager.stop(agentId)
      throw error
    }
  }

  private publishConnection(entry: ConnectionEntry): void {
    this.connections.set(entry.agentId, entry)
    entry.connection.closed.then(() => {
      const current = this.connections.get(entry.agentId)
      if (current !== entry) {
        return
      }
      const error = new Error(`ACP agent disconnected: ${entry.agentId}`)
      this.failConnectionChannels(entry, error)
      this.connections.delete(entry.agentId)
      void this.processManager.stop(entry.agentId)
    })
  }

  private requireSelectedAuthMethod(
    entry: ConnectionEntry,
    methodId: string,
    secretRefs: Record<string, string>,
  ): ProviderAuthMethod {
    const advertisedMethods = projectAcpAuthMethods(entry.initResult?.authMethods ?? [])
    const method = advertisedMethods.find(candidate => candidate.id === methodId)
    const invalid = !method
      || method.status !== 'supported'
      || (method.kind !== 'env_var' && Object.keys(secretRefs).length > 0)

    if (invalid || !method) {
      throw new ProviderRuntimeError(ProviderErrors.authRequired(ACP_RUNTIME_KIND, advertisedMethods))
    }

    if (method.kind === 'env_var') {
      const fields = method.fields ?? []
      const advertisedNames = new Set(fields.map(field => field.name))
      const hasUnknownRef = Object.keys(secretRefs).some(name => !advertisedNames.has(name))
      const hasMissingRef = fields.some(field => !field.optional && !secretRefs[field.name])
      if (hasUnknownRef || hasMissingRef) {
        throw new ProviderRuntimeError(ProviderErrors.authRequired(ACP_RUNTIME_KIND, advertisedMethods))
      }
    }

    return method
  }

  private resolveAuthEnvironment(secretRefs: Record<string, string>): Record<string, string> {
    try {
      return Object.fromEntries(Object.entries(secretRefs).map(([name, ref]) => [name, this.readSecret(ref)]))
    }
    catch (error) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(ACP_RUNTIME_KIND), { cause: error })
    }
  }

  private async closeUnpublishedConnection(entry: ConnectionEntry): Promise<void> {
    entry.connection.close()
    await this.processManager.stop(entry.agentId)
  }

  private async requestWithDeadline<T>(input: {
    conn: ConnectionEntry
    operation: string
    timeoutMs: number
    sessionId?: string
    abortController?: AbortController
    mapAuthRequired?: boolean
    request: (signal: AbortSignal) => Promise<T>
  }): Promise<T> {
    const abortController = input.abortController ?? new AbortController()
    const timeoutError = new ProviderRuntimeError(ProviderErrors.requestFailed(
      ACP_RUNTIME_KIND,
      input.operation,
      `ACP ${input.operation} timed out after ${input.timeoutMs}ms`,
    ))
    let timeout: ReturnType<typeof setTimeout> | undefined
    const requestPromise = Promise.resolve().then(() => input.request(abortController.signal))
    void requestPromise.catch(() => {})
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(reject, input.timeoutMs, timeoutError)
    })

    try {
      return await Promise.race([requestPromise, timeoutPromise])
    }
    catch (error) {
      if (error === timeoutError) {
        abortController.abort(timeoutError)
        if (input.sessionId) {
          await settleBestEffort(
            input.conn.agent.notify(methods.agent.session.cancel, { sessionId: input.sessionId }),
            50,
          )
        }
        await this.invalidateConnection(input.conn, timeoutError)
        throw timeoutError
      }
      if (error instanceof ProviderRuntimeError) {
        throw error
      }
      if (error instanceof RequestError && error.code === -32000 && input.mapAuthRequired !== false) {
        input.conn.authenticatedMethodId = null
        throw new ProviderRuntimeError(
          ProviderErrors.authRequired(ACP_RUNTIME_KIND, projectAcpAuthMethods(input.conn.initResult?.authMethods ?? [])),
          { cause: sanitizedRequestError(error) },
        )
      }
      const detail = error instanceof RequestError
        ? `ACP ${input.operation} failed with JSON-RPC code ${error.code}`
        : `ACP ${input.operation} failed`
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(ACP_RUNTIME_KIND, input.operation, detail),
        { cause: error instanceof RequestError ? sanitizedRequestError(error) : sanitizedUnknownError(input.operation) },
      )
    }
    finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }

  private async invalidateConnection(conn: ConnectionEntry, error: Error): Promise<void> {
    if (this.connections.get(conn.agentId) === conn) {
      this.connections.delete(conn.agentId)
    }
    this.failConnectionChannels(conn, error)
    conn.connection.close(error)
    await this.processManager.stop(conn.agentId)
  }

  private getConnection(agentId: string): ConnectionEntry {
    const conn = this.connections.get(agentId)
    if (!conn) {
      throw new Error(`Agent ${agentId} is not connected`)
    }
    return conn
  }

  private closeChannel(conn: ConnectionEntry, sessionId: string, reason: SessionChannel['closedBy']): void {
    if (!reason) {
      return
    }

    const channel = conn.channels.get(sessionId)
    if (!channel || channel.closedBy) {
      return
    }

    channel.closedBy = reason
    conn.channels.delete(sessionId)

    if (reason.kind === 'cancelled') {
      channel.queue.close()
      return
    }

    channel.queue.fail(reason.error)
  }

  private failConnectionChannels(conn: ConnectionEntry, error: Error): void {
    for (const sessionId of [...conn.channels.keys()]) {
      this.closeChannel(conn, sessionId, { kind: 'disconnected', error })
    }
  }

  private cacheSessionState(
    conn: ConnectionEntry,
    sessionId: string,
    response: AcpSessionState,
  ): void {
    conn.sessionStates.set(sessionId, response)
  }

  private async handlePermissionRequest(
    agentId: string,
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    if (!this.permissionHandler) {
      return { outcome: { outcome: 'cancelled' } }
    }

    const request: AcpPermissionRequest = {
      agentId,
      sessionId: params.sessionId,
      providerMethod: 'requestPermission',
      toolTitle: params.toolCall.title ?? 'Unknown operation',
      options: params.options.map(option => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
    }
    const runtimeContext = this.promptRuntimeContexts.get(toUsageKey(agentId, params.sessionId))
    if (runtimeContext) {
      request.runtimeContext = runtimeContext
    }

    const response = await this.permissionHandler(request)
    if (response.outcome === 'cancelled') {
      return { outcome: { outcome: 'cancelled' } }
    }

    return {
      outcome: {
        outcome: 'selected',
        optionId: response.optionId ?? '',
      },
    }
  }

  private handleSessionUpdate(agentId: string, params: SessionNotification): void {
    const conn = this.connections.get(agentId)
    if (params.update.sessionUpdate === 'session_info_update') {
      if (params.update.title) {
        for (const handler of [...this.sessionTitleHandlers]) {
          try {
            handler(params.sessionId, params.update.title)
          }
          catch {
            // handlers must not break ACP session processing
          }
        }
      }
      return
    }

    if (params.update.sessionUpdate === 'config_option_update') {
      const state = conn?.sessionStates.get(params.sessionId)
      if (state) {
        state.configOptions = params.update.configOptions
      }
      return
    }

    if (conn?.restoringSessionLoads.has(params.sessionId)) {
      return
    }

    const channel = conn?.channels.get(params.sessionId)
    if (!channel) {
      return
    }

    for (const event of channel.mapper.convert(params.update)) {
      channel.queue.push(event)
    }
  }

  private async readClientTextFile(
    path: string,
    line: number | null | undefined,
    limit: number | null | undefined,
  ): Promise<{ content: string }> {
    const content = await fsp.readFile(path, 'utf-8')
    if (line === undefined || line === null) {
      return { content }
    }

    const start = Math.max(0, line - 1)
    const lines = content.split('\n')
    const end = limit === undefined || limit === null ? undefined : start + Math.max(0, limit)
    return { content: lines.slice(start, end).join('\n') }
  }

  private requestSessionConfigOption(
    agent: ClientContext,
    params: SetSessionConfigOptionRequest,
    cancellationSignal: AbortSignal,
  ): Promise<SetSessionConfigOptionResponse> {
    return agent.request<SetSessionConfigOptionResponse, SetSessionConfigOptionRequest>(
      methods.agent.session.setConfigOption,
      params,
      { cancellationSignal },
    )
  }

  private async requestClientFileWriteApproval(agentId: string, sessionId: string, targetPath: string): Promise<void> {
    if (!this.permissionHandler) {
      throw new Error('ACP file write requires an approval handler before writing client filesystem paths')
    }

    const request: AcpPermissionRequest = {
      agentId,
      sessionId,
      providerMethod: 'client.writeTextFile',
      toolTitle: [
        'ACP agent requested a non-Cradle-owned filesystem write.',
        `Target path: ${targetPath}`,
        'Owner boundary: client filesystem outside Cradle-owned data.',
      ].join(' '),
      options: [
        { optionId: 'allow_file_write_once', name: 'Allow write once', kind: 'allow_once' },
        { optionId: 'reject_file_write_once', name: 'Deny write', kind: 'reject_once' },
      ],
    }
    const runtimeContext = this.promptRuntimeContexts.get(toUsageKey(agentId, sessionId))
    if (runtimeContext) {
      request.runtimeContext = runtimeContext
    }

    const response = await this.permissionHandler(request)

    if (response.outcome !== 'selected' || response.optionId !== 'allow_file_write_once') {
      throw new Error('User denied ACP client filesystem write')
    }
  }
}

function toUsageKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`
}

function toTokenUsage(response: PromptResponse | null): TokenUsage | null {
  const usage = readUsage(response)
  if (!usage) {
    return null
  }
  return {
    promptTokens: usage.inputTokens ?? 0,
    completionTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
  }
}

function mapAcpStopReason(reason: StopReason): Extract<UIMessageChunk, { type: 'finish' }>['finishReason'] {
  switch (reason) {
    case 'end_turn':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'max_turn_requests':
      return 'other'
    case 'refusal':
      return 'content-filter'
    case 'cancelled':
      return 'other'
  }
}

function readUsage(response: PromptResponse | null): {
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
} | null {
  return response?.usage ?? null
}

function readAcpSessionState(response: { modes?: SessionModeState | null, configOptions?: SessionConfigOption[] | null }): AcpSessionState {
  return {
    modes: response.modes ?? null,
    configOptions: response.configOptions ?? [],
  }
}

type AcpSelectConfigOption = Extract<SessionConfigOption, { type: 'select' }>

function isModelConfigOption(option: SessionConfigOption): option is AcpSelectConfigOption {
  return option.type === 'select' && option.category === 'model'
}

function hasConfigValue(option: AcpSelectConfigOption, value: string): boolean {
  return option.options.some(entry => 'options' in entry
    ? entry.options.some(item => item.value === value)
    : entry.value === value)
}

function formatSessionConfigOptionValue(value: string | boolean): { type: 'boolean', value: boolean } | { value: string } {
  return typeof value === 'boolean'
    ? { type: 'boolean', value }
    : { value }
}

async function settleBestEffort(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      operation.catch(() => {}),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs)
      }),
    ])
  }
  finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function sanitizedRequestError(error: RequestError): RequestError {
  return new RequestError(error.code, `ACP JSON-RPC request failed with code ${error.code}`)
}

function sanitizedUnknownError(operation: string): Error {
  return new Error(`ACP ${operation} failed without a JSON-RPC error code`)
}
