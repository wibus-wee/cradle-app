import { promises as fsp } from 'node:fs'

import type {
  Agent,
  Client,
  InitializeResponse,
  LoadSessionResponse,
  McpServer,
  NewSessionResponse,
  PromptResponse,
  ResumeSessionResponse,
  SessionConfigOption,
  SessionModelState,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import type { UIMessageChunk } from 'ai'

import { getRegisteredStdioMcpServers } from '../../../plugins/mcp-registry'
import type { ProviderKind, RuntimeKind } from '../../chat-runtime/runtime-provider-types'
import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import type { AcpConnectionRecord } from './config'
import type { AcpProcessManager } from './process-manager'
import { AcpChunkMapper } from './timeline-mapper'

export interface AcpSessionState {
  models: SessionModelState | null
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

export function listRegisteredAcpMcpServers(): McpServer[] {
  return Object.entries(getRegisteredStdioMcpServers()).map(([name, config]) => ({
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
  closedBy: { kind: 'cancelled' } | { kind: 'disconnected', error: Error } | null
}

interface ConnectionEntry {
  agentId: string
  connection: ClientSideConnection
  initResult: InitializeResponse | null
  sessionStates: Map<string, AcpSessionState>
  channels: Map<string, SessionChannel>
  restoringSessionLoads: Set<string>
}

export class AcpConnectionManager {
  private readonly connections = new Map<string, ConnectionEntry>()
  private readonly pendingConnects = new Map<string, Promise<InitializeResponse>>()
  private readonly sessionTitleHandlers = new Set<(acpSessionId: string, title: string) => void>()
  private readonly usageBySessionKey = new Map<string, TokenUsage | null>()
  private readonly promptRuntimeContexts = new Map<string, AcpPromptRuntimeContext>()
  private permissionHandler: AcpPermissionHandler | null = null

  constructor(private readonly processManager: AcpProcessManager) {}

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

  async newSession(agentId: string, cwd: string): Promise<NewSessionResponse & AcpSessionState> {
    const conn = this.getConnection(agentId)
    const response = await conn.connection.newSession({ cwd, mcpServers: listRegisteredAcpMcpServers() })
    const sessionState = readAcpSessionState(response)
    this.cacheSessionState(conn, response.sessionId, sessionState)
    return { ...response, models: sessionState.models, configOptions: sessionState.configOptions }
  }

  supportsLoadSession(agentId: string): boolean {
    return !!this.getConnection(agentId).initResult?.agentCapabilities?.loadSession
  }

  supportsResumeSession(agentId: string): boolean {
    return !!this.getConnection(agentId).initResult?.agentCapabilities?.sessionCapabilities?.resume
  }

  async loadSession(agentId: string, sessionId: string, cwd: string): Promise<LoadSessionResponse & AcpSessionState> {
    const conn = this.getConnection(agentId)
    if (!this.supportsLoadSession(agentId)) {
      throw new Error(`Agent ${agentId} does not support session/load`)
    }

    conn.restoringSessionLoads.add(sessionId)
    try {
      const response = await conn.connection.loadSession({ sessionId, cwd, mcpServers: listRegisteredAcpMcpServers() })
      const sessionState = readAcpSessionState(response)
      this.cacheSessionState(conn, sessionId, sessionState)
      return { ...response, models: sessionState.models, configOptions: sessionState.configOptions }
    }
    finally {
      conn.restoringSessionLoads.delete(sessionId)
    }
  }

  async resumeSession(agentId: string, sessionId: string, cwd: string): Promise<ResumeSessionResponse & AcpSessionState> {
    const conn = this.getConnection(agentId)
    if (!this.supportsResumeSession(agentId)) {
      throw new Error(`Agent ${agentId} does not support session/resume`)
    }

    const response = await conn.connection.unstable_resumeSession({ sessionId, cwd, mcpServers: listRegisteredAcpMcpServers() })
    const sessionState = readAcpSessionState(response)
    this.cacheSessionState(conn, sessionId, sessionState)
    return { ...response, models: sessionState.models, configOptions: sessionState.configOptions }
  }

  getSessionState(agentId: string, sessionId: string): AcpSessionState | null {
    return this.connections.get(agentId)?.sessionStates.get(sessionId) ?? null
  }

  async setSessionModel(agentId: string, sessionId: string, modelId: string): Promise<void> {
    const conn = this.getConnection(agentId)
    await conn.connection.unstable_setSessionModel({ sessionId, modelId })
    const state = conn.sessionStates.get(sessionId)
    if (state?.models) {
      state.models.currentModelId = modelId
    }
  }

  async setSessionConfigOption(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void> {
    const conn = this.getConnection(agentId)
    const params = { sessionId, configId, ...formatSessionConfigOptionValue(value) }
    const response = await conn.connection.setSessionConfigOption(params)
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
    const mapper = new AcpChunkMapper()
    const queue = new ChunkQueue()
    const channel: SessionChannel = { mapper, queue, closedBy: null }
    conn.channels.set(sessionId, channel)

    const usageKey = toUsageKey(agentId, sessionId)
    this.usageBySessionKey.delete(usageKey)
    if (runtimeContext) {
      this.promptRuntimeContexts.set(usageKey, runtimeContext)
    }

    let promptResult: PromptResponse | null = null
    let promptError: Error | null = null

    const promptDone = conn.connection.prompt({ sessionId, prompt: [{ type: 'text', text: message }] })
      .then((result) => {
        promptResult = result
        for (const event of mapper.flush()) {
          queue.push(event)
        }
        queue.close()
      })
      .catch((error: unknown) => {
        promptError = error instanceof Error ? error : new Error(String(error))
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

      this.usageBySessionKey.set(usageKey, toTokenUsage(promptResult))
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
    this.closeChannel(conn, sessionId, { kind: 'cancelled' })
    this.usageBySessionKey.delete(toUsageKey(agentId, sessionId))
    await conn.connection.cancel({ sessionId })
  }

  async disconnect(agentId: string): Promise<void> {
    const conn = this.connections.get(agentId)
    if (conn) {
      this.failConnectionChannels(conn, new Error(`ACP agent disconnected: ${agentId}`))
      this.connections.delete(agentId)
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
    const args = JSON.parse(record.args) as string[]
    const env = JSON.parse(record.env) as Record<string, string>
    const procEntry = this.processManager.spawn({
      agentId,
      cmd: record.cmd,
      args,
      env,
      distributionType: record.distributionType,
      installPath: record.installPath,
    })

    const connection = new ClientSideConnection(
      (agent: Agent): Client => this.createClient(agentId, agent),
      ndJsonStream(procEntry.stdinWeb, procEntry.stdoutWeb),
    )

    const initResult = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'Cradle Server', version: '1.0.0' },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    })

    const entry: ConnectionEntry = {
      agentId,
      connection,
      initResult,
      sessionStates: new Map(),
      channels: new Map(),
      restoringSessionLoads: new Set(),
    }

    this.connections.set(agentId, entry)

    connection.closed.then(() => {
      const current = this.connections.get(agentId)
      if (!current) {
        return
      }
      this.failConnectionChannels(current, new Error(`ACP agent disconnected: ${agentId}`))
      this.connections.delete(agentId)
    })

    return initResult
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

  private createClient(agentId: string, _agent: Agent): Client {
    return {
      requestPermission: async (params) => {
        const options = readPermissionOptions(params.options)
        if (!this.permissionHandler) {
          return { outcome: { outcome: 'cancelled' as const } }
        }

        const request: AcpPermissionRequest = {
          agentId,
          sessionId: params.sessionId,
          providerMethod: 'requestPermission',
          toolTitle: params.toolCall?.title ?? 'Unknown operation',
          options: options.map(option => ({
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
          return { outcome: { outcome: 'cancelled' as const } }
        }

        return {
          outcome: {
            outcome: 'selected' as const,
            optionId: response.optionId ?? '',
          },
        }
      },

      sessionUpdate: async (params: SessionNotification) => {
        if (params.update.sessionUpdate === 'session_info_update') {
          const title = (params.update as { title?: string | null }).title
          if (title) {
            for (const handler of [...this.sessionTitleHandlers]) {
              try {
                handler(params.sessionId, title)
              }
              catch {
                // handlers must not break ACP session processing
              }
            }
          }
          return
        }

        const conn = this.connections.get(agentId)
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
      },

      readTextFile: async (params) => {
        const content = await fsp.readFile(params.path, 'utf-8')
        return { content }
      },

      writeTextFile: async (params) => {
        await this.requestClientFileWriteApproval(agentId, params.sessionId, params.path)
        await fsp.writeFile(params.path, params.content, 'utf-8')
        return {}
      },
    }
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

function readUsage(response: PromptResponse | null): {
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
} | null {
  return response?.usage ?? null
}

function readAcpSessionState(response: { models?: SessionModelState | null, configOptions?: SessionConfigOption[] | null }): AcpSessionState {
  return {
    models: response.models ?? null,
    configOptions: response.configOptions ?? [],
  }
}

function readPermissionOptions(value: unknown): Array<{ optionId: string, name: string, kind: string }> {
  return Array.isArray(value)
    ? value as Array<{ optionId: string, name: string, kind: string }>
    : []
}

function formatSessionConfigOptionValue(value: string | boolean): { type: 'boolean', value: boolean } | { value: string } {
  return typeof value === 'boolean'
    ? { type: 'boolean', value }
    : { value }
}
