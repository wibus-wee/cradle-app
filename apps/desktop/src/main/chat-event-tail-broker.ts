import type { WebContents } from 'electron'

export const DESKTOP_CHAT_EVENT_TAIL_EVENT_CHANNEL = 'chat-event-tail:event'
export const DESKTOP_CHAT_EVENT_TAIL_CLOSED_CHANNEL = 'chat-event-tail:closed'
export const DESKTOP_CHAT_EVENT_TAIL_ERROR_CHANNEL = 'chat-event-tail:error'

export interface DesktopChatSubscribeSessionEventsRequest {
  sessionId: string
  afterVersion?: number
}

export interface DesktopChatSubscribeGlobalSessionEventsRequest {
  afterSequenceId?: number
  workspaceId?: string | null
}

export interface DesktopChatEventTailAbortRequest {
  tailId: string
}

export interface DesktopChatEventTailHandle {
  tailId: string
  scope: 'session' | 'sessions'
  sessionId: string | null
}

export interface DesktopChatEventTailEvent {
  tailId: string
  sessionId: string
  event: unknown
}

export interface DesktopChatEventTailClosedEvent {
  tailId: string
  sessionId: string
  reason: 'aborted' | 'upstream-closed'
}

export interface DesktopChatEventTailErrorEvent {
  tailId: string
  sessionId: string
  message: string
}

export interface DesktopChatEventTailDiagnostics {
  tails: Array<{
    scope: 'session' | 'sessions'
    sessionId: string | null
    workspaceId: string | null
    afterVersion: number | null
    afterSequenceId: number | null
    subscriberCount: number
    replayEventCount: number
    startedAtMs: number
  }>
}

export const DESKTOP_CHAT_EVENT_TAIL_REPLAY_MAX_EVENTS = 512

type ChatEventTailFetch = typeof fetch

interface ChatEventTailBrokerOptions {
  serverUrl: string
  fetchFn?: ChatEventTailFetch
}

interface ChatEventTailSink {
  isDestroyed: () => boolean
  send: (channel: string, payload: unknown) => void
  once?: (eventName: 'destroyed', listener: () => void) => void
  removeListener?: (eventName: 'destroyed', listener: () => void) => void
}

interface TailSubscriber {
  tailId: string
  sink: ChatEventTailSink
  webContents: WebContents | null
  afterVersion: number
  afterSequenceId: number
}

interface TailBufferItem {
  version: number | null
  sequenceId: number | null
  event: unknown
}

interface WebContentsCleanupRegistration {
  webContents: WebContents
  tailIds: Set<string>
  handleDestroyed: () => void
}

interface TailEntry {
  scope: 'session' | 'sessions'
  key: string
  sessionId: string | null
  workspaceId: string | null
  afterVersion: number
  afterSequenceId: number
  controller: AbortController
  subscribers: Map<string, TailSubscriber>
  eventBuffer: TailBufferItem[]
  startedAtMs: number
  closed: boolean
}

export class ChatEventTailBroker {
  private readonly serverUrl: string
  private readonly fetchFn: ChatEventTailFetch
  private readonly entriesBySessionId = new Map<string, TailEntry>()
  private readonly globalEntriesByKey = new Map<string, TailEntry>()
  private readonly cleanupByWebContents = new WeakMap<WebContents, WebContentsCleanupRegistration>()
  private nextTailIndex = 0

  constructor(options: ChatEventTailBrokerOptions) {
    this.serverUrl = options.serverUrl
    this.fetchFn = options.fetchFn ?? fetch
  }

  subscribeSessionEvents(
    webContents: WebContents,
    request: DesktopChatSubscribeSessionEventsRequest,
  ): DesktopChatEventTailHandle {
    const afterVersion = Math.max(0, request.afterVersion ?? 0)
    const entry = this.readOrCreateEntry(request.sessionId, afterVersion)
    const tailId = this.createTailId(request.sessionId)
    const subscriber: TailSubscriber = {
      tailId,
      sink: webContents,
      webContents,
      afterVersion,
      afterSequenceId: 0,
    }
    entry.subscribers.set(tailId, subscriber)
    this.attachWebContentsCleanup(entry, subscriber)
    this.replayEventsToSubscriber(entry, subscriber)
    return {
      tailId,
      scope: 'session',
      sessionId: request.sessionId,
    }
  }

  subscribeGlobalSessionEvents(
    webContents: WebContents,
    request: DesktopChatSubscribeGlobalSessionEventsRequest,
  ): DesktopChatEventTailHandle {
    const afterSequenceId = Math.max(0, request.afterSequenceId ?? 0)
    const workspaceId = request.workspaceId?.trim() || null
    const entry = this.readOrCreateGlobalEntry(workspaceId, afterSequenceId)
    const tailId = this.createTailId(`sessions-${workspaceId ?? 'all'}`)
    const subscriber: TailSubscriber = {
      tailId,
      sink: webContents,
      webContents,
      afterVersion: 0,
      afterSequenceId,
    }
    entry.subscribers.set(tailId, subscriber)
    this.attachWebContentsCleanup(entry, subscriber)
    this.replayEventsToSubscriber(entry, subscriber)
    return {
      tailId,
      scope: 'sessions',
      sessionId: null,
    }
  }

  abortTail(webContents: WebContents, request: DesktopChatEventTailAbortRequest): void {
    const located = this.findSubscriber(request.tailId)
    if (!located || located.subscriber.webContents !== webContents) {
      return
    }
    this.removeSubscriber(located.entry, request.tailId)
    this.closeSubscriber(located.entry, located.subscriber, 'aborted')
    this.abortEntryIfUnobserved(located.entry)
  }

  diagnostics(): DesktopChatEventTailDiagnostics {
    return {
      tails: [...this.entriesBySessionId.values(), ...this.globalEntriesByKey.values()].map(entry => ({
        scope: entry.scope,
        sessionId: entry.sessionId,
        workspaceId: entry.workspaceId,
        afterVersion: entry.scope === 'session' ? entry.afterVersion : null,
        afterSequenceId: entry.scope === 'sessions' ? entry.afterSequenceId : null,
        subscriberCount: entry.subscribers.size,
        replayEventCount: entry.eventBuffer.length,
        startedAtMs: entry.startedAtMs,
      })),
    }
  }

  stop(): void {
    for (const entry of [...this.entriesBySessionId.values(), ...this.globalEntriesByKey.values()]) {
      entry.closed = true
      entry.controller.abort()
      for (const subscriber of [...entry.subscribers.values()]) {
        this.closeSubscriber(entry, subscriber, 'aborted')
        this.removeSubscriber(entry, subscriber.tailId)
      }
    }
    this.entriesBySessionId.clear()
    this.globalEntriesByKey.clear()
  }

  private readOrCreateEntry(sessionId: string, afterVersion: number): TailEntry {
    const existing = this.entriesBySessionId.get(sessionId)
    if (existing && !existing.closed) {
      return existing
    }

    const controller = new AbortController()
    const entry: TailEntry = {
      scope: 'session',
      key: sessionId,
      sessionId,
      workspaceId: null,
      afterVersion,
      afterSequenceId: 0,
      controller,
      subscribers: new Map(),
      eventBuffer: [],
      startedAtMs: Date.now(),
      closed: false,
    }
    this.entriesBySessionId.set(sessionId, entry)
    void this.openUpstream(entry)
    return entry
  }

  private readOrCreateGlobalEntry(workspaceId: string | null, afterSequenceId: number): TailEntry {
    const key = workspaceId ?? 'all'
    const existing = this.globalEntriesByKey.get(key)
    if (existing && !existing.closed) {
      return existing
    }

    const controller = new AbortController()
    const entry: TailEntry = {
      scope: 'sessions',
      key,
      sessionId: null,
      workspaceId,
      afterVersion: 0,
      afterSequenceId,
      controller,
      subscribers: new Map(),
      eventBuffer: [],
      startedAtMs: Date.now(),
      closed: false,
    }
    this.globalEntriesByKey.set(key, entry)
    void this.openUpstream(entry)
    return entry
  }

  private async openUpstream(entry: TailEntry): Promise<void> {
    const url = entry.scope === 'session'
      ? new URL(`/chat/sessions/${encodeURIComponent(entry.sessionId ?? '')}/events`, this.serverUrl)
      : new URL('/events', this.serverUrl)
    if (entry.scope === 'session') {
      url.searchParams.set('afterVersion', String(entry.afterVersion))
    }
 else {
      url.searchParams.set('scope', 'sessions')
      url.searchParams.set('afterSequenceId', String(entry.afterSequenceId))
      if (entry.workspaceId) {
        url.searchParams.set('workspaceId', entry.workspaceId)
      }
    }

    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        signal: entry.controller.signal,
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Chat event tail upstream failed: ${response.status} ${body}`)
      }
      await this.pumpResponse(entry, response)
    }
    catch (error) {
      if (entry.controller.signal.aborted) {
        return
      }
      this.errorSubscribers(entry, readErrorMessage(error))
      this.deleteEntry(entry)
    }
  }

  private async pumpResponse(entry: TailEntry, response: Response): Promise<void> {
    if (!response.body) {
      this.errorSubscribers(entry, 'Chat event tail upstream response had no body')
      this.deleteEntry(entry)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

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
          this.forwardSseFrame(entry, frame)
        }
      }

      buffer += decoder.decode()
      for (const frame of splitFinalSseFrames(buffer)) {
        this.forwardSseFrame(entry, frame)
      }
      this.closeEntry(entry, 'upstream-closed')
    }
    catch (error) {
      if (entry.controller.signal.aborted) {
        return
      }
      this.errorSubscribers(entry, readErrorMessage(error))
      this.deleteEntry(entry)
    }
  }

  private forwardSseFrame(entry: TailEntry, frame: string): void {
    const value = readSseDataFrame(frame)
    if (value === null) {
      return
    }
    const event = parseJsonObjectFrame(value)
    this.forwardEvent(entry, event)
  }

  private forwardEvent(entry: TailEntry, event: unknown): void {
    bufferTailEvent(entry, event)
    for (const subscriber of [...entry.subscribers.values()]) {
      this.sendEventToSubscriber(entry, subscriber, event)
    }
  }

  private replayEventsToSubscriber(entry: TailEntry, subscriber: TailSubscriber): void {
    for (const item of entry.eventBuffer) {
      if (entry.scope === 'session' && (item.version === null || item.version <= subscriber.afterVersion)) {
        continue
      }
      if (
        entry.scope === 'sessions'
        && (item.sequenceId === null || item.sequenceId <= subscriber.afterSequenceId)
      ) {
        continue
      }
      this.sendEventToSubscriber(entry, subscriber, item.event)
    }
  }

  private sendEventToSubscriber(entry: TailEntry, subscriber: TailSubscriber, event: unknown): void {
    if (subscriber.sink.isDestroyed()) {
      this.removeSubscriber(entry, subscriber.tailId)
      this.abortEntryIfUnobserved(entry)
      return
    }
    subscriber.sink.send(DESKTOP_CHAT_EVENT_TAIL_EVENT_CHANNEL, {
      tailId: subscriber.tailId,
      sessionId: entry.sessionId ?? readEventSessionId(event) ?? '',
      event,
    } satisfies DesktopChatEventTailEvent)
  }

  private closeEntry(entry: TailEntry, reason: DesktopChatEventTailClosedEvent['reason']): void {
    if (entry.closed) {
      return
    }
    entry.closed = true
    for (const subscriber of [...entry.subscribers.values()]) {
      this.closeSubscriber(entry, subscriber, reason)
      this.removeSubscriber(entry, subscriber.tailId)
    }
    this.deleteEntry(entry)
  }

  private closeSubscriber(
    entry: TailEntry,
    subscriber: TailSubscriber,
    reason: DesktopChatEventTailClosedEvent['reason'],
  ): void {
    if (subscriber.sink.isDestroyed()) {
      this.removeSubscriber(entry, subscriber.tailId)
      return
    }
    subscriber.sink.send(DESKTOP_CHAT_EVENT_TAIL_CLOSED_CHANNEL, {
      tailId: subscriber.tailId,
      sessionId: entry.sessionId ?? '',
      reason,
    } satisfies DesktopChatEventTailClosedEvent)
  }

  private errorSubscribers(entry: TailEntry, message: string): void {
    for (const subscriber of [...entry.subscribers.values()]) {
      if (subscriber.sink.isDestroyed()) {
        this.removeSubscriber(entry, subscriber.tailId)
        continue
      }
      subscriber.sink.send(DESKTOP_CHAT_EVENT_TAIL_ERROR_CHANNEL, {
        tailId: subscriber.tailId,
        sessionId: entry.sessionId ?? '',
        message,
      } satisfies DesktopChatEventTailErrorEvent)
      this.removeSubscriber(entry, subscriber.tailId)
    }
  }

  private attachWebContentsCleanup(entry: TailEntry, subscriber: TailSubscriber): void {
    const webContents = subscriber.webContents
    if (!webContents) {
      return
    }
    let registration = this.cleanupByWebContents.get(webContents)
    if (!registration) {
      registration = {
        webContents,
        tailIds: new Set(),
        handleDestroyed: () => {
          const current = this.cleanupByWebContents.get(webContents)
          if (!current) {
            return
          }
          this.cleanupByWebContents.delete(webContents)
          for (const tailId of [...current.tailIds]) {
            const located = this.findSubscriber(tailId)
            if (!located) {
              continue
            }
            this.removeSubscriber(located.entry, tailId)
            this.abortEntryIfUnobserved(located.entry)
          }
          current.tailIds.clear()
        },
      }
      this.cleanupByWebContents.set(webContents, registration)
      webContents.once('destroyed', registration.handleDestroyed)
    }
    registration.tailIds.add(subscriber.tailId)
  }

  private removeSubscriber(entry: TailEntry, tailId: string): void {
    const subscriber = entry.subscribers.get(tailId)
    if (!subscriber) {
      return
    }
    entry.subscribers.delete(tailId)
    this.detachWebContentsCleanup(subscriber)
  }

  private detachWebContentsCleanup(subscriber: TailSubscriber): void {
    const webContents = subscriber.webContents
    if (!webContents) {
      return
    }
    const registration = this.cleanupByWebContents.get(webContents)
    if (!registration) {
      return
    }
    registration.tailIds.delete(subscriber.tailId)
    if (registration.tailIds.size > 0) {
      return
    }
    registration.webContents.removeListener('destroyed', registration.handleDestroyed)
    this.cleanupByWebContents.delete(registration.webContents)
  }

  private abortEntryIfUnobserved(entry: TailEntry): void {
    if (entry.subscribers.size > 0 || entry.closed) {
      return
    }
    entry.closed = true
    entry.controller.abort()
    this.deleteEntry(entry)
  }

  private findSubscriber(tailId: string): { entry: TailEntry, subscriber: TailSubscriber } | null {
    for (const entry of [...this.entriesBySessionId.values(), ...this.globalEntriesByKey.values()]) {
      const subscriber = entry.subscribers.get(tailId)
      if (subscriber) {
        return { entry, subscriber }
      }
    }
    return null
  }

  private createTailId(sessionId: string): string {
    this.nextTailIndex += 1
    return `desktop-chat-event-tail-${sessionId}-${Date.now()}-${this.nextTailIndex}`
  }

  private deleteEntry(entry: TailEntry): void {
    if (entry.scope === 'session') {
      this.entriesBySessionId.delete(entry.sessionId ?? '')
      return
    }
    this.globalEntriesByKey.delete(entry.key)
  }
}

function bufferTailEvent(entry: TailEntry, event: unknown): void {
  const version = readEventVersion(event)
  const sequenceId = readEventSequenceId(event)
  if (entry.scope === 'session' && version === null) {
    return
  }
  if (entry.scope === 'sessions' && sequenceId === null) {
    return
  }
  entry.eventBuffer.push({ version, sequenceId, event })
  if (entry.eventBuffer.length > DESKTOP_CHAT_EVENT_TAIL_REPLAY_MAX_EVENTS) {
    entry.eventBuffer.splice(0, entry.eventBuffer.length - DESKTOP_CHAT_EVENT_TAIL_REPLAY_MAX_EVENTS)
  }
}

function readEventVersion(event: unknown): number | null {
  const record = readRecord(event)
  if (!record || typeof record.version !== 'number') {
    return null
  }
  return record.version
}

function readEventSequenceId(event: unknown): number | null {
  const record = readRecord(event)
  if (!record || typeof record.sequenceId !== 'number') {
    return null
  }
  return record.sequenceId
}

function readEventSessionId(event: unknown): string | null {
  const record = readRecord(event)
  if (!record || typeof record.sessionId !== 'string') {
    return null
  }
  return record.sessionId
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
    throw new Error('Chat event tail frame must be a JSON object')
  }
  return parsed
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Chat event tail failed'
}
