import type { UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream } from 'ai'

import type { MessageReconcileChange } from '~/store/chat'
import { useChatStore } from '~/store/chat'

import type { ChatStreamChunk } from './chat-stream-types'
import { emitChatRunSettled } from './sse-chat-transport'

const STREAM_FLUSH_INTERVAL_MS = 125
type ChatStreamingStore = Pick<typeof useChatStore, 'getState'>

export class ChatStreamingHandler {
  private readonly sessionId: string
  private readonly messageId: string
  private readonly requestStartedAtMs: number
  private readonly mode: 'local' | 'passive'
  private readonly useStoredMessageSnapshot: boolean
  private readonly store: ChatStreamingStore
  private readonly emitSettledEvents: boolean
  private activeMessageId: string | null = null
  private terminated = false
  private pendingMessages = new Map<string, { message: UIMessage, receivedAtMs: number, dirtyToolCallIds: Set<string> }>()
  private latestMessageSnapshots = new Map<string, { message: UIMessage, receivedAtMs: number, dirtyToolCallIds: Set<string> }>()
  private pendingDirtyToolCallIds = new Set<string>()
  private rafId: number | null = null
  private flushTimerId: number | null = null
  private microtaskFlushQueued = false
  private lastFlushAtMs = 0
  private settled = false
  private currentChunkReplay = false
  private replayBatchOpen = false

  constructor(
    sessionId: string,
    messageId: string,
    requestStartedAtMs = performance.now(),
    options: {
      mode?: 'local' | 'passive'
      useStoredMessageSnapshot?: boolean
      store?: ChatStreamingStore
      emitSettledEvents?: boolean
    } = {},
  ) {
    this.sessionId = sessionId
    this.messageId = messageId
    this.requestStartedAtMs = requestStartedAtMs
    this.mode = options.mode ?? 'local'
    this.useStoredMessageSnapshot = options.useStoredMessageSnapshot ?? true
    this.store = options.store ?? useChatStore
    this.emitSettledEvents = options.emitSettledEvents ?? true
  }

  start(controller: AbortController): void {
    const store = this.store.getState()
    store.beginRunDisplayMeta(this.messageId, this.requestStartedAtMs)
    if (this.mode === 'passive') {
      store.acquireStreamLease({
        sessionId: this.sessionId,
        messageId: this.messageId,
        source: 'passive',
      })
      return
    }
    this.appendLocalPlaceholder()
    store.startGeneration(this.sessionId, this.messageId, controller)
  }

  async consume(stream: ReadableStream<ChatStreamChunk>): Promise<void> {
    const initialMessage = this.useStoredMessageSnapshot
      ? cloneMessageForStreamReader(
          this.store.getState().messagesMap.get(this.sessionId)?.find(message => message.id === (this.activeMessageId ?? this.messageId)),
        )
      : undefined

    for await (const message of readUIMessageStream<UIMessage>({
      message: initialMessage ?? {
        id: this.activeMessageId ?? this.messageId,
        role: 'assistant',
        parts: [],
      },
      stream: this.trackStreamChanges(stream),
      terminateOnError: true,
    })) {
      this.applyMessageSnapshot(message, this.currentChunkReplay)
    }
    this.stageLatestMessageSnapshots()
    this.flushPendingMessages()
  }

  finish(): void {
    this.flushPendingMessages()
    if (this.terminated) {
      return
    }
    this.terminated = true
    const messageId = this.activeMessageId ?? this.messageId
    const store = this.store.getState()
    if (this.mode === 'passive') {
      this.emitSettled(messageId, 'complete')
      return
    }
    store.finishGeneration(messageId)
    if (this.activeMessageId === null) {
      store.removeMessage(this.sessionId, this.messageId)
    }
    this.emitSettled(messageId, 'complete')
  }

  fail(error: string): void {
    this.flushPendingMessages()
    if (this.terminated) {
      return
    }
    this.terminated = true
    const messageId = this.activeMessageId ?? this.messageId
    const store = this.store.getState()
    store.failGeneration(messageId, error)
    this.emitSettled(messageId, 'error')
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.flushTimerId !== null) {
      window.clearTimeout(this.flushTimerId)
      this.flushTimerId = null
    }
    this.microtaskFlushQueued = false
    this.pendingMessages.clear()
    this.latestMessageSnapshots.clear()
    this.pendingDirtyToolCallIds.clear()
    this.replayBatchOpen = false
  }

  readActiveMessageId(): string {
    return this.activeMessageId ?? this.messageId
  }

  private flushPendingMessages(): void {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.rafId)
      }
      this.rafId = null
    }
    if (this.flushTimerId !== null) {
      window.clearTimeout(this.flushTimerId)
      this.flushTimerId = null
    }
    if (this.pendingMessages.size === 0) {
      return
    }
    const store = this.store.getState()
    for (const [messageId, { message, receivedAtMs, dirtyToolCallIds }] of this.pendingMessages) {
      store.markRunFirstEvent(messageId, receivedAtMs)
      if (hasVisibleContent(message)) {
        store.markRunFirstContent(messageId, receivedAtMs)
      }
      const displayMessage = store.projectStreamingMessageForDisplay(this.sessionId, message)
      if (displayMessage.id !== messageId) {
        store.moveStreamingMessage(this.sessionId, messageId, displayMessage.id)
      }
      const reconcileChange: MessageReconcileChange = { dirtyToolCallIds }
      store.updateMessage(this.sessionId, displayMessage.id, () => displayMessage, reconcileChange)
    }
    this.pendingMessages.clear()
    this.lastFlushAtMs = performance.now()
  }

  private appendLocalPlaceholder(): void {
    const store = this.store.getState()
    const existing = store.messagesMap.get(this.sessionId)?.some(message => message.id === this.messageId) ?? false
    if (existing) {
      return
    }
    store.appendMessage(this.sessionId, {
      id: this.messageId,
      role: 'assistant',
      parts: [],
    })
  }

  private applyMessageSnapshot(message: UIMessage, replay: boolean): void {
    const receivedAtMs = performance.now()
    this.activateServerMessage(message.id)

    const current = this.pendingMessages.get(message.id)
    const dirtyToolCallIds = new Set(current?.dirtyToolCallIds)
    for (const toolCallId of this.pendingDirtyToolCallIds) {
      dirtyToolCallIds.add(toolCallId)
    }
    this.pendingDirtyToolCallIds.clear()
    const snapshot = { message, receivedAtMs, dirtyToolCallIds }
    this.latestMessageSnapshots.set(message.id, snapshot)
    this.pendingMessages.set(message.id, snapshot)

    if (replay) {
      this.replayBatchOpen = true
      return
    }

    if (typeof requestAnimationFrame !== 'function') {
      if (!this.microtaskFlushQueued) {
        this.microtaskFlushQueued = true
        queueMicrotask(() => {
          this.microtaskFlushQueued = false
          this.flushPendingMessages()
        })
      }
      return
    }

    if (this.rafId !== null || this.flushTimerId !== null) {
      return
    }

    const elapsedSinceFlush = receivedAtMs - this.lastFlushAtMs
    if (elapsedSinceFlush >= STREAM_FLUSH_INTERVAL_MS) {
      this.scheduleAnimationFrameFlush()
      return
    }

    this.flushTimerId = window.setTimeout(() => {
      this.flushTimerId = null
      this.scheduleAnimationFrameFlush()
    }, STREAM_FLUSH_INTERVAL_MS - elapsedSinceFlush)
  }

  private scheduleAnimationFrameFlush(): void {
    if (this.rafId !== null) {
      return
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      this.flushPendingMessages()
    })
  }

  private stageLatestMessageSnapshots(): void {
    for (const [messageId, snapshot] of this.latestMessageSnapshots) {
      this.pendingMessages.set(messageId, snapshot)
    }
  }

  private activateServerMessage(messageId: string): void {
    if (this.activeMessageId === messageId) {
      return
    }

    const store = this.store.getState()
    const existing = store.messagesMap.get(this.sessionId)?.some(message => message.id === messageId) ?? false
    const canReplaceLocalPlaceholder = this.mode === 'local'
      && this.activeMessageId === null
      && !existing
      && (store.messagesMap.get(this.sessionId)?.some(message => message.id === this.messageId) ?? false)

    if (canReplaceLocalPlaceholder) {
      store.updateMessage(this.sessionId, this.messageId, message => ({
        ...message,
        id: messageId,
      }))
    }
    else if (!existing) {
      store.appendMessage(this.sessionId, {
        id: messageId,
        role: 'assistant',
        parts: [],
      })
    }

    if (this.activeMessageId === null && messageId !== this.messageId) {
      if (this.mode === 'passive') {
        store.moveRunDisplayMeta(this.messageId, messageId)
        store.moveStreamLease(this.sessionId, this.messageId, messageId)
      }
      else {
        store.moveStreamingMessage(this.sessionId, this.messageId, messageId)
      }
    }

    this.activeMessageId = messageId
  }

  private emitSettled(messageId: string | null, status: 'complete' | 'error'): void {
    if (this.settled) {
      return
    }
    this.settled = true
    if (!this.emitSettledEvents) {
      return
    }
    emitChatRunSettled({
      chatSessionId: this.sessionId,
      messageId,
      status,
    })
  }

  private trackStreamChanges(stream: ReadableStream<ChatStreamChunk>): ReadableStream<UIMessageChunk> {
    return stream.pipeThrough(new TransformStream<ChatStreamChunk, UIMessageChunk>({
      transform: (item, controller) => {
        if (!item.replay && this.replayBatchOpen) {
          this.flushPendingMessages()
          this.replayBatchOpen = false
        }
        this.currentChunkReplay = item.replay
        this.recordChunkChange(item.chunk)
        controller.enqueue(item.chunk)
      },
    }))
  }

  private recordChunkChange(chunk: UIMessageChunk): void {
    if ('toolCallId' in chunk && typeof chunk.toolCallId === 'string') {
      this.pendingDirtyToolCallIds.add(chunk.toolCallId)
    }
  }
}

function cloneMessageForStreamReader(message: UIMessage | undefined): UIMessage | undefined {
  if (!message) {
    return undefined
  }
  return {
    ...message,
    parts: [...message.parts],
  }
}

function hasVisibleContent(message: UIMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === 'text') {
      return part.text.length > 0
    }
    if (part.type === 'reasoning') {
      const value = 'text' in part ? part.text : undefined
      return typeof value === 'string' && value.length > 0
    }
    if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
      return true
    }
    return false
  })
}
