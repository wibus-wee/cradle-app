import type { WebContents } from 'electron'

import { getDesktopServerAuthHeaders } from './server-process'

export const DESKTOP_CHAT_STREAM_CHUNK_CHANNEL = 'chat-stream:chunk'
export const DESKTOP_CHAT_STREAM_CLOSED_CHANNEL = 'chat-stream:closed'
export const DESKTOP_CHAT_STREAM_ERROR_CHANNEL = 'chat-stream:error'

export type DesktopChatStreamMode = 'response' | 'session'
type DesktopChatThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh'
type RuntimeSettingsValue = string | number | boolean

export interface DesktopChatStartResponseRequest {
  sessionId: string
  body: {
    text: string
    files?: unknown[]
    messages?: unknown[]
    providerTargetId?: string
    modelId?: string | null
    thinkingEffort?: DesktopChatThinkingEffort
    /** Provider-native session settings (e.g. permissionMode for claude-agent). */
    runtimeSettings?: Record<string, RuntimeSettingsValue>
  }
}

export interface DesktopChatSubscribeSessionRequest {
  sessionId: string
}

export interface DesktopChatAbortRequest {
  streamId: string
}

export interface DesktopChatStreamHandle {
  streamId: string
  sessionId: string
  runId: string | null
  telemetrySessionId: string | null
  telemetryRunId: string | null
  assistantMessageId?: string
  userMessageId?: string
}

export interface DesktopChatStreamChunkEvent {
  streamId: string
  sessionId: string
  runId: string | null
  chunk: unknown
  replay?: boolean
}

export interface DesktopChatStreamClosedEvent {
  streamId: string
  sessionId: string
  runId: string | null
  reason: 'done' | 'aborted' | 'upstream-closed'
}

export interface DesktopChatStreamErrorEvent {
  streamId: string
  sessionId: string
  runId: string | null
  message: string
}

export interface DesktopChatStreamDiagnostics {
  streams: Array<{
    sessionId: string
    mode: DesktopChatStreamMode
    upstreamRequestId: string
    runId: string | null
    assistantMessageId?: string
    userMessageId?: string
    subscriberCount: number
    replayChunkCount: number
    keepAliveWithoutSubscribers: boolean
    startedAtMs: number
  }>
}

export const DESKTOP_CHAT_REPLAY_MAX_CHUNKS = 512
export const DESKTOP_CHAT_REPLAY_MAX_BYTES = 4 * 1024 * 1024
const DESKTOP_CHAT_REPLAY_DELTA_MERGE_MAX_CHARS = 8_192

type ChatStreamFetch = typeof fetch

interface ChatStreamBrokerOptions {
  serverUrl: string
  fetchFn?: ChatStreamFetch
  upstreamOpenTimeoutMs?: number
}

interface UpstreamHandle {
  sessionId: string
  runId: string | null
  telemetrySessionId: string | null
  telemetryRunId: string | null
  assistantMessageId?: string
  userMessageId?: string
}

interface StreamSubscriber {
  streamId: string
  sink: ChatStreamSink
  webContents: WebContents | null
  replayCursor: number
}

interface ChatStreamSink {
  isDestroyed: () => boolean
  send: (channel: string, payload: unknown) => void
  once?: (eventName: 'destroyed', listener: () => void) => void
  removeListener?: (eventName: 'destroyed', listener: () => void) => void
}

interface ReplayBufferItem {
  cursor: number
  chunk: unknown
  byteSize: number
  coalesceKey: string | null
}

interface ReplayBuffer {
  chunks: ReplayBufferItem[]
  nextCursor: number
  totalBytes: number
  indexByCoalesceKey: Map<string, number>
  activeTextPartIds: Set<string>
  activeReasoningPartIds: Set<string>
  activeToolInvocationIds: Set<string>
}

interface WebContentsCleanupRegistration {
  webContents: WebContents
  streamIds: Set<string>
  handleDestroyed: () => void
}

interface UpstreamEntry {
  sessionId: string
  mode: DesktopChatStreamMode
  upstreamRequestId: string
  controller: AbortController
  subscribers: Map<string, StreamSubscriber>
  replayBuffer: ReplayBuffer
  handlePromise: Promise<UpstreamHandle>
  runId: string | null
  telemetrySessionId: string | null
  telemetryRunId: string | null
  assistantMessageId?: string
  userMessageId?: string
  keepAliveWithoutSubscribers: boolean
  startedAtMs: number
  closed: boolean
  openTimedOut: boolean
}

interface UpstreamRequest {
  sessionId: string
  mode: DesktopChatStreamMode
  request: RequestInit
  path: string
  keepAliveWithoutSubscribers: boolean
}

const HEADER_RUN_ID = 'x-cradle-run-id'
const HEADER_TELEMETRY_SESSION_ID = 'x-cradle-telemetry-session-id'
const HEADER_TELEMETRY_RUN_ID = 'x-cradle-telemetry-run-id'
const HEADER_ASSISTANT_MESSAGE_ID = 'x-cradle-assistant-message-id'
const HEADER_USER_MESSAGE_ID = 'x-cradle-user-message-id'
const HEADER_DESKTOP_UPSTREAM_REQUEST_ID = 'x-cradle-desktop-chat-upstream-id'
const HEADER_DESKTOP_UPSTREAM_MODE = 'x-cradle-desktop-chat-upstream-mode'
const DEFAULT_UPSTREAM_OPEN_TIMEOUT_MS = 30_000

export class ChatStreamBroker {
  private readonly serverUrl: string
  private readonly fetchFn: ChatStreamFetch
  private readonly upstreamOpenTimeoutMs: number
  private readonly entriesBySessionId = new Map<string, UpstreamEntry>()
  private readonly cleanupByWebContents = new WeakMap<WebContents, WebContentsCleanupRegistration>()
  private nextStreamIndex = 0
  private nextUpstreamRequestIndex = 0

  constructor(options: ChatStreamBrokerOptions) {
    this.serverUrl = options.serverUrl
    this.fetchFn = options.fetchFn ?? fetch
    this.upstreamOpenTimeoutMs = options.upstreamOpenTimeoutMs ?? DEFAULT_UPSTREAM_OPEN_TIMEOUT_MS
  }

  async startResponse(
    webContents: WebContents,
    request: DesktopChatStartResponseRequest,
  ): Promise<DesktopChatStreamHandle> {
    return await this.startResponseForSink(webContents, webContents, request)
  }

  async startResponseDetached(
    request: DesktopChatStartResponseRequest,
  ): Promise<DesktopChatStreamHandle> {
    return await this.startResponseForSink(createDetachedChatStreamSink(), null, request)
  }

  private async startResponseForSink(
    sink: ChatStreamSink,
    webContents: WebContents | null,
    request: DesktopChatStartResponseRequest,
  ): Promise<DesktopChatStreamHandle> {
    const entry = this.readOrCreateEntry({
      sessionId: request.sessionId,
      mode: 'response',
      path: `/chat/sessions/${encodeURIComponent(request.sessionId)}/response`,
      keepAliveWithoutSubscribers: true,
      request: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      },
    })
    return await this.attachSubscriber(entry, sink, webContents)
  }

  async subscribeSession(
    webContents: WebContents,
    request: DesktopChatSubscribeSessionRequest,
  ): Promise<DesktopChatStreamHandle> {
    const entry = this.readOrCreateEntry({
      sessionId: request.sessionId,
      mode: 'session',
      path: `/chat/sessions/${encodeURIComponent(request.sessionId)}/stream`,
      keepAliveWithoutSubscribers: false,
      request: { method: 'GET' },
    })
    return await this.attachSubscriber(entry, webContents, webContents)
  }

  abortStream(webContents: WebContents, request: DesktopChatAbortRequest): void {
    const located = this.findSubscriber(request.streamId)
    if (!located || located.subscriber.webContents !== webContents) {
      return
    }
    this.removeSubscriber(located.entry, request.streamId)
    this.closeSubscriber(located.entry, located.subscriber, 'aborted')
    this.abortEntryIfUnobserved(located.entry)
  }

  diagnostics(): DesktopChatStreamDiagnostics {
    return {
      streams: Array.from(this.entriesBySessionId.values(), entry => ({
        sessionId: entry.sessionId,
        mode: entry.mode,
        upstreamRequestId: entry.upstreamRequestId,
        runId: entry.runId,
        assistantMessageId: entry.assistantMessageId,
        userMessageId: entry.userMessageId,
        subscriberCount: entry.subscribers.size,
        replayChunkCount: entry.replayBuffer.chunks.length,
        keepAliveWithoutSubscribers: entry.keepAliveWithoutSubscribers,
        startedAtMs: entry.startedAtMs,
      })),
    }
  }

  stop(): void {
    for (const entry of this.entriesBySessionId.values()) {
      entry.closed = true
      entry.controller.abort()
      for (const subscriber of [...entry.subscribers.values()]) {
        this.closeSubscriber(entry, subscriber, 'aborted')
        this.removeSubscriber(entry, subscriber.streamId)
      }
    }
    this.entriesBySessionId.clear()
  }

  private readOrCreateEntry(request: UpstreamRequest): UpstreamEntry {
    const existing = this.entriesBySessionId.get(request.sessionId)
    if (existing && !existing.closed) {
      if (canReuseEntry(existing, request)) {
        return existing
      }
      // Suppress the expected AbortError from the replaced entry's in-flight fetch,
      // so it doesn't surface as an unhandled promise rejection.
      existing.handlePromise.catch(() => {})
      this.closeEntry(existing, 'aborted')
      existing.controller.abort()
    }

    const controller = new AbortController()
    const entry: UpstreamEntry = {
      sessionId: request.sessionId,
      mode: request.mode,
      upstreamRequestId: this.createUpstreamRequestId(request.sessionId),
      controller,
      subscribers: new Map(),
      replayBuffer: createReplayBuffer(),
      handlePromise: Promise.resolve({
        sessionId: request.sessionId,
        runId: null,
        telemetrySessionId: null,
        telemetryRunId: null,
      }),
      runId: null,
      telemetrySessionId: null,
      telemetryRunId: null,
      keepAliveWithoutSubscribers: request.keepAliveWithoutSubscribers,
      startedAtMs: Date.now(),
      closed: false,
      openTimedOut: false,
    }
    entry.handlePromise = this.openUpstream(entry, request)
    this.entriesBySessionId.set(request.sessionId, entry)
    return entry
  }

  private async attachSubscriber(
    entry: UpstreamEntry,
    sink: ChatStreamSink,
    webContents: WebContents | null,
  ): Promise<DesktopChatStreamHandle> {
    const streamId = this.createStreamId(entry.sessionId)
    const subscriber: StreamSubscriber = {
      streamId,
      sink,
      webContents,
      replayCursor: 0,
    }
    entry.subscribers.set(streamId, subscriber)
    this.attachWebContentsCleanup(entry, subscriber)

    try {
      const handle = await entry.handlePromise
      this.replayChunksToSubscriber(entry, subscriber)
      return {
        streamId,
        sessionId: handle.sessionId,
        runId: handle.runId,
        telemetrySessionId: handle.telemetrySessionId,
        telemetryRunId: handle.telemetryRunId,
        assistantMessageId: handle.assistantMessageId,
        userMessageId: handle.userMessageId,
      }
    }
    catch (error) {
      this.removeSubscriber(entry, streamId)
      if (isExpectedEntryAbort(entry)) {
        return {
          streamId,
          sessionId: entry.sessionId,
          runId: entry.runId,
          telemetrySessionId: entry.telemetrySessionId,
          telemetryRunId: entry.telemetryRunId,
          assistantMessageId: entry.assistantMessageId,
          userMessageId: entry.userMessageId,
        }
      }
      throw error
    }
  }

  private attachWebContentsCleanup(entry: UpstreamEntry, subscriber: StreamSubscriber): void {
    const webContents = subscriber.webContents
    if (!webContents) {
      return
    }
    let registration = this.cleanupByWebContents.get(webContents)
    if (!registration) {
      registration = {
        webContents,
        streamIds: new Set(),
        handleDestroyed: () => {
          const current = this.cleanupByWebContents.get(webContents)
          if (!current) {
            return
          }
          this.cleanupByWebContents.delete(webContents)
          for (const streamId of [...current.streamIds]) {
            const located = this.findSubscriber(streamId)
            if (!located) {
              continue
            }
            this.removeSubscriber(located.entry, streamId)
            this.abortEntryIfUnobserved(located.entry)
          }
          current.streamIds.clear()
        },
      }
      this.cleanupByWebContents.set(webContents, registration)
      webContents.once('destroyed', registration.handleDestroyed)
    }
    registration.streamIds.add(subscriber.streamId)
  }

  private async openUpstream(entry: UpstreamEntry, request: UpstreamRequest): Promise<UpstreamHandle> {
    const openTimeout = setTimeout(() => {
      if (entry.closed || entry.runId !== null) {
        return
      }
      entry.openTimedOut = true
      entry.controller.abort()
    }, this.upstreamOpenTimeoutMs)
    openTimeout.unref?.()

    try {
      const headers = new Headers(request.request.headers)
      new Headers(getDesktopServerAuthHeaders()).forEach((value, key) => headers.set(key, value))
      headers.set(HEADER_DESKTOP_UPSTREAM_REQUEST_ID, entry.upstreamRequestId)
      headers.set(HEADER_DESKTOP_UPSTREAM_MODE, request.mode)
      const response = await this.fetchFn(new URL(request.path, this.serverUrl), {
        ...request.request,
        headers,
        signal: entry.controller.signal,
      })
      clearTimeout(openTimeout)
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Chat stream upstream failed: ${response.status} ${body}`)
      }

      entry.runId = response.headers.get(HEADER_RUN_ID)
      entry.telemetrySessionId = response.headers.get(HEADER_TELEMETRY_SESSION_ID)
      entry.telemetryRunId = response.headers.get(HEADER_TELEMETRY_RUN_ID)
      entry.assistantMessageId = response.headers.get(HEADER_ASSISTANT_MESSAGE_ID) ?? undefined
      entry.userMessageId = response.headers.get(HEADER_USER_MESSAGE_ID) ?? undefined

      const handle: UpstreamHandle = {
        sessionId: entry.sessionId,
        runId: entry.runId,
        telemetrySessionId: entry.telemetrySessionId,
        telemetryRunId: entry.telemetryRunId,
        assistantMessageId: entry.assistantMessageId,
        userMessageId: entry.userMessageId,
      }
      void this.pumpResponse(entry, response)
      return handle
    }
    catch (error) {
      clearTimeout(openTimeout)
      const message = entry.openTimedOut
        ? `Chat stream upstream did not return response headers within ${this.upstreamOpenTimeoutMs}ms`
        : readErrorMessage(error)
      this.errorSubscribers(entry, message)
      this.deleteEntryIfCurrent(entry)
      throw entry.openTimedOut ? new Error(message) : error
    }
  }

  private async pumpResponse(entry: UpstreamEntry, response: Response): Promise<void> {
    if (!response.body) {
      this.errorSubscribers(entry, 'Chat stream upstream response had no body')
      this.deleteEntryIfCurrent(entry)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let doneFrameSeen = false

    try {
      while (true) {
        const result = await reader.read()
        if (result.done) {
          break
        }
        buffer += decoder.decode(result.value, { stream: true })
        const frames = splitCompleteSseFrames(buffer)
        buffer = frames.remainder
        for (const frame of frames.completeFrames) {
          const value = readSseDataFrame(frame)
          if (value === null) {
            continue
          }
          if (value === '[DONE]') {
            doneFrameSeen = true
            this.closeEntry(entry, 'done')
            return
          }
          const chunk = parseJsonObjectFrame(value)
          this.forwardChunk(entry, chunk)
        }
      }

      buffer += decoder.decode()
      for (const frame of splitFinalSseFrames(buffer)) {
        const value = readSseDataFrame(frame)
        if (value === '[DONE]') {
          doneFrameSeen = true
          this.closeEntry(entry, 'done')
          return
        }
        if (value) {
          this.forwardChunk(entry, parseJsonObjectFrame(value))
        }
      }
      this.closeEntry(entry, doneFrameSeen ? 'done' : 'upstream-closed')
    }
    catch (error) {
      if (entry.controller.signal.aborted) {
        this.closeEntry(entry, 'aborted')
        return
      }
      this.errorSubscribers(entry, readErrorMessage(error))
      this.deleteEntryIfCurrent(entry)
    }
  }

  private forwardChunk(entry: UpstreamEntry, chunk: unknown): void {
    bufferReplayChunk(entry.replayBuffer, chunk)
    for (const subscriber of [...entry.subscribers.values()]) {
      this.sendChunkToSubscriber(entry, subscriber, chunk)
    }
  }

  private replayChunksToSubscriber(entry: UpstreamEntry, subscriber: StreamSubscriber): void {
    for (const item of entry.replayBuffer.chunks) {
      if (item.cursor < subscriber.replayCursor) {
        continue
      }
      this.sendChunkToSubscriber(entry, subscriber, item.chunk, item.cursor + 1, true)
    }
  }

  private sendChunkToSubscriber(
    entry: UpstreamEntry,
    subscriber: StreamSubscriber,
    chunk: unknown,
    cursorAfter = entry.replayBuffer.nextCursor,
    replay = false,
  ): void {
    if (subscriber.sink.isDestroyed()) {
      this.removeSubscriber(entry, subscriber.streamId)
      this.abortEntryIfUnobserved(entry)
      return
    }
    subscriber.sink.send(DESKTOP_CHAT_STREAM_CHUNK_CHANNEL, {
      streamId: subscriber.streamId,
      sessionId: entry.sessionId,
      runId: entry.runId,
      chunk,
      replay,
    } satisfies DesktopChatStreamChunkEvent)
    subscriber.replayCursor = cursorAfter
  }

  private closeEntry(entry: UpstreamEntry, reason: DesktopChatStreamClosedEvent['reason']): void {
    if (entry.closed) {
      return
    }
    entry.closed = true
    for (const subscriber of [...entry.subscribers.values()]) {
      this.closeSubscriber(entry, subscriber, reason)
      this.removeSubscriber(entry, subscriber.streamId)
    }
    this.deleteEntryIfCurrent(entry)
  }

  private closeSubscriber(
    entry: UpstreamEntry,
    subscriber: StreamSubscriber,
    reason: DesktopChatStreamClosedEvent['reason'],
  ): void {
    if (subscriber.sink.isDestroyed()) {
      this.removeSubscriber(entry, subscriber.streamId)
      return
    }
    subscriber.sink.send(DESKTOP_CHAT_STREAM_CLOSED_CHANNEL, {
      streamId: subscriber.streamId,
      sessionId: entry.sessionId,
      runId: entry.runId,
      reason,
    } satisfies DesktopChatStreamClosedEvent)
  }

  private errorSubscribers(entry: UpstreamEntry, message: string): void {
    for (const subscriber of [...entry.subscribers.values()]) {
      if (subscriber.sink.isDestroyed()) {
        this.removeSubscriber(entry, subscriber.streamId)
        continue
      }
      subscriber.sink.send(DESKTOP_CHAT_STREAM_ERROR_CHANNEL, {
        streamId: subscriber.streamId,
        sessionId: entry.sessionId,
        runId: entry.runId,
        message,
      } satisfies DesktopChatStreamErrorEvent)
      this.removeSubscriber(entry, subscriber.streamId)
    }
  }

  private removeSubscriber(entry: UpstreamEntry, streamId: string): void {
    const subscriber = entry.subscribers.get(streamId)
    if (!subscriber) {
      return
    }
    entry.subscribers.delete(streamId)
    this.detachWebContentsCleanup(subscriber)
  }

  private detachWebContentsCleanup(subscriber: StreamSubscriber): void {
    const webContents = subscriber.webContents
    if (!webContents) {
      return
    }
    const registration = this.cleanupByWebContents.get(webContents)
    if (!registration) {
      return
    }
    registration.streamIds.delete(subscriber.streamId)
    if (registration.streamIds.size > 0) {
      return
    }
    registration.webContents.removeListener('destroyed', registration.handleDestroyed)
    this.cleanupByWebContents.delete(registration.webContents)
  }

  private abortEntryIfUnobserved(entry: UpstreamEntry): void {
    if (entry.subscribers.size > 0 || entry.keepAliveWithoutSubscribers || entry.closed) {
      return
    }
    entry.closed = true
    entry.controller.abort()
    this.deleteEntryIfCurrent(entry)
  }

  private findSubscriber(streamId: string): { entry: UpstreamEntry, subscriber: StreamSubscriber } | null {
    for (const entry of this.entriesBySessionId.values()) {
      const subscriber = entry.subscribers.get(streamId)
      if (subscriber) {
        return { entry, subscriber }
      }
    }
    return null
  }

  private createStreamId(sessionId: string): string {
    this.nextStreamIndex += 1
    return `desktop-chat-${sessionId}-${Date.now()}-${this.nextStreamIndex}`
  }

  private createUpstreamRequestId(sessionId: string): string {
    this.nextUpstreamRequestIndex += 1
    return `desktop-chat-upstream-${sessionId}-${Date.now()}-${this.nextUpstreamRequestIndex}`
  }

  private deleteEntryIfCurrent(entry: UpstreamEntry): void {
    if (this.entriesBySessionId.get(entry.sessionId) === entry) {
      this.entriesBySessionId.delete(entry.sessionId)
    }
  }
}

function canReuseEntry(existing: UpstreamEntry, request: UpstreamRequest): boolean {
  if (request.mode === 'session') {
    return true
  }
  return existing.mode === 'response' && existing.runId !== null
}

function createDetachedChatStreamSink(): ChatStreamSink {
  return {
    isDestroyed: () => false,
    send: () => {
      // Detached notification replies only need the broker to drain the server stream.
    },
  }
}

function isExpectedEntryAbort(entry: UpstreamEntry): boolean {
  return entry.closed && entry.controller.signal.aborted
}

function createReplayBuffer(): ReplayBuffer {
  return {
    chunks: [],
    nextCursor: 0,
    totalBytes: 0,
    indexByCoalesceKey: new Map(),
    activeTextPartIds: new Set(),
    activeReasoningPartIds: new Set(),
    activeToolInvocationIds: new Set(),
  }
}

function bufferReplayChunk(buffer: ReplayBuffer, chunk: unknown): void {
  recordReplayProtocolState(buffer, chunk)
  if (coalesceReplayChunk(buffer, chunk)) {
    trimReplayBuffer(buffer)
    return
  }

  const coalesceKey = readReplayCoalesceKey(chunk)
  const item: ReplayBufferItem = {
    cursor: buffer.nextCursor,
    chunk,
    byteSize: estimateReplayChunkBytes(chunk),
    coalesceKey,
  }
  buffer.nextCursor += 1
  buffer.chunks.push(item)
  buffer.totalBytes += item.byteSize
  if (coalesceKey) {
    buffer.indexByCoalesceKey.set(coalesceKey, buffer.chunks.length - 1)
  }
  trimReplayBuffer(buffer)
}

function coalesceReplayChunk(buffer: ReplayBuffer, chunk: unknown): boolean {
  const key = readReplayCoalesceKey(chunk)
  if (!key) {
    return false
  }

  const existingIndex = buffer.indexByCoalesceKey.get(key)
  if (existingIndex === undefined) {
    return false
  }

  const existing = buffer.chunks[existingIndex]
  if (!existing || existing.coalesceKey !== key) {
    buffer.indexByCoalesceKey.delete(key)
    return false
  }

  const merged = mergeReplayChunk(existing.chunk, chunk)
  if (!merged) {
    return false
  }

  buffer.totalBytes -= existing.byteSize
  existing.chunk = merged
  existing.byteSize = estimateReplayChunkBytes(merged)
  buffer.totalBytes += existing.byteSize
  return true
}

function trimReplayBuffer(buffer: ReplayBuffer): void {
  let changed = false
  while (
    buffer.chunks.length > DESKTOP_CHAT_REPLAY_MAX_CHUNKS
    || buffer.totalBytes > DESKTOP_CHAT_REPLAY_MAX_BYTES
  ) {
    const removeIndex = findRemovableReplayItemIndex(buffer)
    if (removeIndex === -1) {
      break
    }
    const [removed] = buffer.chunks.splice(removeIndex, 1)
    if (!removed) {
      break
    }
    buffer.totalBytes = Math.max(0, buffer.totalBytes - removed.byteSize)
    changed = true
  }
  if (changed) {
    rebuildReplayCoalesceIndex(buffer)
  }
}

function findRemovableReplayItemIndex(buffer: ReplayBuffer): number {
  const firstUnprotectedIndex = buffer.chunks.findIndex((_, index) =>
    !isReplayDependencyForLaterChunk(buffer, index))
  if (firstUnprotectedIndex !== -1) {
    return firstUnprotectedIndex
  }
  return -1
}

function isReplayDependencyForLaterChunk(buffer: ReplayBuffer, index: number): boolean {
  const items = buffer.chunks
  const chunk = readRecord(items[index]?.chunk)
  if (!chunk) {
    return false
  }

  const type = chunk.type
  if (type === 'text-start') {
    const id = typeof chunk.id === 'string' ? chunk.id : null
    return id !== null && (
      buffer.activeTextPartIds.has(id)
      || hasLaterChunk(items, index, candidate =>
        (candidate.type === 'text-delta' || candidate.type === 'text-end')
        && candidate.id === id)
    )
  }
  if (type === 'reasoning-start') {
    const id = typeof chunk.id === 'string' ? chunk.id : null
    return id !== null && (
      buffer.activeReasoningPartIds.has(id)
      || hasLaterChunk(items, index, candidate =>
        (candidate.type === 'reasoning-delta' || candidate.type === 'reasoning-end')
        && candidate.id === id)
    )
  }
  if (
    type === 'tool-input-start'
    || type === 'tool-input-available'
    || type === 'tool-input-error'
  ) {
    const toolCallId = typeof chunk.toolCallId === 'string' ? chunk.toolCallId : null
    return toolCallId !== null && (
      buffer.activeToolInvocationIds.has(toolCallId)
      || hasLaterChunk(items, index, candidate =>
        isToolDependentReplayChunk(candidate)
        && candidate.toolCallId === toolCallId)
    )
  }
  return false
}

function recordReplayProtocolState(buffer: ReplayBuffer, chunk: unknown): void {
  const record = readRecord(chunk)
  if (!record) {
    return
  }
  if (
    (record.type === 'tool-input-start'
      || record.type === 'tool-input-available'
      || record.type === 'tool-input-error')
    && typeof record.toolCallId === 'string'
  ) {
    buffer.activeToolInvocationIds.add(record.toolCallId)
  }
  if (
    typeof record.toolCallId === 'string'
    && (
      (record.type === 'tool-output-available' && record.preliminary !== true)
      || record.type === 'tool-output-error'
      || record.type === 'tool-output-denied'
    )
  ) {
    buffer.activeToolInvocationIds.delete(record.toolCallId)
  }
  if (record.type === 'text-start' && typeof record.id === 'string') {
    buffer.activeTextPartIds.add(record.id)
  }
  if (record.type === 'text-end' && typeof record.id === 'string') {
    buffer.activeTextPartIds.delete(record.id)
  }
  if (record.type === 'reasoning-start' && typeof record.id === 'string') {
    buffer.activeReasoningPartIds.add(record.id)
  }
  if (record.type === 'reasoning-end' && typeof record.id === 'string') {
    buffer.activeReasoningPartIds.delete(record.id)
  }
}

function hasLaterChunk(
  items: ReplayBufferItem[],
  index: number,
  predicate: (chunk: Record<string, unknown>) => boolean,
): boolean {
  for (let nextIndex = index + 1; nextIndex < items.length; nextIndex += 1) {
    const candidate = readRecord(items[nextIndex]?.chunk)
    if (candidate && predicate(candidate)) {
      return true
    }
  }
  return false
}

function isToolDependentReplayChunk(chunk: Record<string, unknown>): boolean {
  return (
    chunk.type === 'tool-input-delta'
    || chunk.type === 'tool-approval-request'
    || chunk.type === 'tool-output-available'
    || chunk.type === 'tool-output-error'
    || chunk.type === 'tool-output-denied'
  )
}

function rebuildReplayCoalesceIndex(buffer: ReplayBuffer): void {
  buffer.indexByCoalesceKey.clear()
  buffer.chunks.forEach((item, index) => {
    if (item.coalesceKey) {
      buffer.indexByCoalesceKey.set(item.coalesceKey, index)
    }
  })
}

function estimateReplayChunkBytes(chunk: unknown): number {
  try {
    const serialized = JSON.stringify(chunk)
    if (typeof serialized === 'string') {
      return new TextEncoder().encode(serialized).byteLength
    }
  }
  catch {
    return 1024
  }
  return 1024
}

function readReplayCoalesceKey(chunk: unknown): string | null {
  const record = readRecord(chunk)
  if (!record) {
    return null
  }

  switch (record.type) {
    case 'text-delta':
      return typeof record.id === 'string' ? `text-delta:${record.id}` : null
    case 'reasoning-delta':
      return typeof record.id === 'string' ? `reasoning-delta:${record.id}` : null
    case 'tool-input-delta':
      return typeof record.toolCallId === 'string' ? `tool-input-delta:${record.toolCallId}` : null
    case 'tool-output-available':
      return typeof record.toolCallId === 'string' ? `tool-output-available:${record.toolCallId}` : null
    default:
      return null
  }
}

function mergeReplayChunk(existing: unknown, next: unknown): unknown | null {
  const existingRecord = readRecord(existing)
  const nextRecord = readRecord(next)
  if (!existingRecord || !nextRecord) {
    return null
  }

  if (
    existingRecord.type === 'text-delta'
    && nextRecord.type === 'text-delta'
    && existingRecord.id === nextRecord.id
    && typeof existingRecord.delta === 'string'
    && typeof nextRecord.delta === 'string'
  ) {
    if (existingRecord.delta.length + nextRecord.delta.length > DESKTOP_CHAT_REPLAY_DELTA_MERGE_MAX_CHARS) {
      return null
    }
    return {
      ...nextRecord,
      delta: `${existingRecord.delta}${nextRecord.delta}`,
      providerMetadata: nextRecord.providerMetadata ?? existingRecord.providerMetadata,
    }
  }

  if (
    existingRecord.type === 'reasoning-delta'
    && nextRecord.type === 'reasoning-delta'
    && existingRecord.id === nextRecord.id
    && typeof existingRecord.delta === 'string'
    && typeof nextRecord.delta === 'string'
  ) {
    if (existingRecord.delta.length + nextRecord.delta.length > DESKTOP_CHAT_REPLAY_DELTA_MERGE_MAX_CHARS) {
      return null
    }
    return {
      ...nextRecord,
      delta: `${existingRecord.delta}${nextRecord.delta}`,
      providerMetadata: nextRecord.providerMetadata ?? existingRecord.providerMetadata,
    }
  }

  if (
    existingRecord.type === 'tool-input-delta'
    && nextRecord.type === 'tool-input-delta'
    && existingRecord.toolCallId === nextRecord.toolCallId
    && typeof existingRecord.inputTextDelta === 'string'
    && typeof nextRecord.inputTextDelta === 'string'
  ) {
    if (
      existingRecord.inputTextDelta.length + nextRecord.inputTextDelta.length
      > DESKTOP_CHAT_REPLAY_DELTA_MERGE_MAX_CHARS
    ) {
      return null
    }
    return {
      ...nextRecord,
      inputTextDelta: `${existingRecord.inputTextDelta}${nextRecord.inputTextDelta}`,
    }
  }

  if (
    existingRecord.type === 'tool-output-available'
    && nextRecord.type === 'tool-output-available'
    && typeof existingRecord.toolCallId === 'string'
    && existingRecord.toolCallId === nextRecord.toolCallId
  ) {
    return { ...nextRecord }
  }

  return null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function splitCompleteSseFrames(buffer: string): { completeFrames: string[], remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  return {
    completeFrames: parts.slice(0, -1),
    remainder: parts.at(-1) ?? '',
  }
}

function splitFinalSseFrames(buffer: string): string[] {
  return buffer
    .replace(/\r\n/g, '\n')
    .split('\n\n')
    .filter(frame => frame.trim().length > 0)
}

function readSseDataFrame(frame: string): string | null {
  const lines = frame.split('\n')
  const dataLines = lines
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trimStart())
  if (dataLines.length === 0) {
    return null
  }
  return dataLines.join('\n')
}

function parseJsonObjectFrame(value: string): unknown {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Chat stream frame must be a JSON object')
  }
  return parsed
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Chat stream failed'
}
