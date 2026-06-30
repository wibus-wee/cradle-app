import type { UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream } from 'ai'

import type { MessageReconcileChange } from '~/store/chat'
import { useChatStore } from '~/store/chat'

import { emitChatRunSettled } from './sse-chat-transport'

const STREAM_FLUSH_INTERVAL_MS = 125

export class ChatStreamingHandler {
  private readonly sessionId: string
  private readonly messageId: string
  private readonly requestStartedAtMs: number
  private readonly mode: 'local' | 'passive'
  private readonly useStoredMessageSnapshot: boolean
  private activeMessageId: string | null = null
  private terminated = false
  private pendingMessages = new Map<string, { message: UIMessage, receivedAtMs: number, dirtyToolCallIds: Set<string> }>()
  private pendingDirtyToolCallIds = new Set<string>()
  private rafId: number | null = null
  private flushTimerId: number | null = null
  private microtaskFlushQueued = false
  private lastFlushAtMs = 0
  private settled = false

  constructor(
    sessionId: string,
    messageId: string,
    requestStartedAtMs = performance.now(),
    options: { mode?: 'local' | 'passive', useStoredMessageSnapshot?: boolean } = {},
  ) {
    this.sessionId = sessionId
    this.messageId = messageId
    this.requestStartedAtMs = requestStartedAtMs
    this.mode = options.mode ?? 'local'
    this.useStoredMessageSnapshot = options.useStoredMessageSnapshot ?? true
  }

  start(controller: AbortController): void {
    const store = useChatStore.getState()
    store.beginRunDisplayMeta(this.messageId, this.requestStartedAtMs)
    if (this.mode === 'passive') {
      store.setPassiveStreamingMessage(this.sessionId, this.messageId, true)
      store.setSessionMeta(this.sessionId, {
        passiveStatus: 'streaming',
        locallyDriving: false,
        localDriverMessageId: undefined,
      })
      return
    }
    this.appendLocalPlaceholder()
    store.startGeneration(this.sessionId, this.messageId, controller)
  }

  async consume(stream: ReadableStream<UIMessageChunk>): Promise<void> {
    const initialMessage = this.useStoredMessageSnapshot
      ? cloneMessageForStreamReader(
          useChatStore.getState().messagesMap.get(this.sessionId)?.find(message => message.id === (this.activeMessageId ?? this.messageId)),
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
      this.applyMessageSnapshot(message)
    }
    this.flushPendingMessages()
  }

  finish(): void {
    this.flushPendingMessages()
    if (this.terminated) {
      return
    }
    this.terminated = true
    const messageId = this.activeMessageId ?? this.messageId
    const store = useChatStore.getState()
    store.finishGeneration(messageId)
    if (this.mode === 'local' && this.activeMessageId === null) {
      store.removeMessage(this.sessionId, this.messageId)
    }
    if (this.mode === 'passive') {
      store.setPassiveStreamingMessage(this.sessionId, messageId, false)
      store.setSessionMeta(this.sessionId, { passiveStatus: 'idle' })
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
    const store = useChatStore.getState()
    store.failGeneration(messageId, error)
    if (this.mode === 'passive') {
      store.setPassiveStreamingMessage(this.sessionId, messageId, false)
      store.setSessionMeta(this.sessionId, { passiveStatus: 'error' })
    }
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
    this.pendingDirtyToolCallIds.clear()
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
    const store = useChatStore.getState()
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
    const store = useChatStore.getState()
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

  private applyMessageSnapshot(message: UIMessage): void {
    const receivedAtMs = performance.now()
    this.activateServerMessage(message.id)

    const current = this.pendingMessages.get(message.id)
    const dirtyToolCallIds = new Set(current?.dirtyToolCallIds)
    for (const toolCallId of this.pendingDirtyToolCallIds) {
      dirtyToolCallIds.add(toolCallId)
    }
    this.pendingDirtyToolCallIds.clear()
    this.pendingMessages.set(message.id, { message, receivedAtMs, dirtyToolCallIds })

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

  private activateServerMessage(messageId: string): void {
    if (this.activeMessageId === messageId) {
      return
    }

    const store = useChatStore.getState()
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
        store.setPassiveStreamingMessage(this.sessionId, this.messageId, false)
        store.setPassiveStreamingMessage(this.sessionId, messageId, true)
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
    emitChatRunSettled({
      chatSessionId: this.sessionId,
      messageId,
      status,
    })
  }

  private trackStreamChanges(stream: ReadableStream<UIMessageChunk>): ReadableStream<UIMessageChunk> {
    return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform: (chunk, controller) => {
        this.recordChunkChange(chunk)
        controller.enqueue(chunk)
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
