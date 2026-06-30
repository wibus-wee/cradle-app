import type { UIMessageChunk } from 'ai'
import { parseJsonEventStream, uiMessageChunkSchema } from 'ai'

interface ChatRunActivityPayload {
  chatSessionId: string
  messageId: string | null
  chunk: UIMessageChunk
}

export type ChatRunSettledStatus = 'complete' | 'aborted' | 'error'

interface ChatRunSettledPayload {
  chatSessionId: string
  messageId: string | null
  status: ChatRunSettledStatus
}

type RunActivityHandler = (data: ChatRunActivityPayload) => void
type RunSettledHandler = (data: ChatRunSettledPayload) => void
type ChatRunBroadcastEvent
  = | { kind: 'activity', payload: ChatRunActivityPayload }
    | { kind: 'settled', payload: ChatRunSettledPayload }

const globalHandlers = new Set<RunActivityHandler>()
const settledHandlers = new Set<RunSettledHandler>()
const CHAT_RUN_BROADCAST_CHANNEL = 'cradle:chat-run-events:v1'
const rendererEventSourceId = createRendererEventSourceId()
let broadcastChannel: BroadcastChannel | null | undefined
let broadcastListenerAttached = false

export function onAnyChatRunEvent(handler: RunActivityHandler): () => void {
  ensureBroadcastListener()
  globalHandlers.add(handler)
  return () => {
    globalHandlers.delete(handler)
  }
}

export function onChatRunSettled(handler: RunSettledHandler): () => void {
  ensureBroadcastListener()
  settledHandlers.add(handler)
  return () => {
    settledHandlers.delete(handler)
  }
}

export function emitChatRunActivity(data: ChatRunActivityPayload): void {
  for (const handler of globalHandlers) {
    handler(data)
  }
  if (data.chunk.type === 'start') {
    publishChatRunBroadcastEvent({ kind: 'activity', payload: data })
  }
}

export function emitChatRunSettled(data: ChatRunSettledPayload): void {
  for (const handler of settledHandlers) {
    handler(data)
  }
  publishChatRunBroadcastEvent({ kind: 'settled', payload: data })
}

function publishChatRunBroadcastEvent(event: ChatRunBroadcastEvent): void {
  const channel = readBroadcastChannel()
  if (!channel) {
    return
  }
  channel.postMessage({
    sourceId: rendererEventSourceId,
    event,
  })
}

function ensureBroadcastListener(): void {
  const channel = readBroadcastChannel()
  if (!channel || broadcastListenerAttached) {
    return
  }
  broadcastListenerAttached = true
  channel.addEventListener('message', (message) => {
    const value = readBroadcastMessage(message.data)
    if (!value || value.sourceId === rendererEventSourceId) {
      return
    }
    if (value.event.kind === 'activity') {
      for (const handler of globalHandlers) {
        handler(value.event.payload)
      }
      return
    }
    for (const handler of settledHandlers) {
      handler(value.event.payload)
    }
  })
}

export function disposeChatRunBroadcast(): void {
  if (broadcastChannel) {
    broadcastChannel.close()
  }
  broadcastChannel = undefined
  broadcastListenerAttached = false
  globalHandlers.clear()
  settledHandlers.clear()
}

function readBroadcastChannel(): BroadcastChannel | null {
  if (broadcastChannel !== undefined) {
    return broadcastChannel
  }
  broadcastChannel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel(CHAT_RUN_BROADCAST_CHANNEL)
    : null
  return broadcastChannel
}

function readBroadcastMessage(value: unknown): { sourceId: string, event: ChatRunBroadcastEvent } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const sourceId = (value as { sourceId?: unknown }).sourceId
  const event = (value as { event?: unknown }).event
  if (typeof sourceId !== 'string' || !event || typeof event !== 'object' || Array.isArray(event)) {
    return null
  }
  const kind = (event as { kind?: unknown }).kind
  const payload = (event as { payload?: unknown }).payload
  if (
    (kind !== 'activity' && kind !== 'settled')
    || !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
  ) {
    return null
  }
  return { sourceId, event: { kind, payload } as ChatRunBroadcastEvent }
}

function createRendererEventSourceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function readChunkMessageId(chunk: UIMessageChunk): string | null {
  if (chunk.type === 'start') {
    return chunk.messageId ?? null
  }
  if ('toolCallId' in chunk && typeof chunk.toolCallId === 'string') {
    return null
  }
  return null
}

export function readTerminalChunkStatus(chunk: UIMessageChunk): ChatRunSettledStatus | null {
  if (chunk.type === 'finish') {
    return 'complete'
  }
  if (chunk.type === 'abort') {
    return 'aborted'
  }
  if (chunk.type === 'error') {
    return 'error'
  }
  return null
}

export function buildUIMessageChunkStreamFromResponse(
  response: Response,
  chatSessionId: string,
): ReadableStream<UIMessageChunk> {
  if (!response.body) {
    throw new Error('SSE stream has no body')
  }

  return parseJsonEventStream({
    stream: response.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(new TransformStream({
    transform(result, controller) {
      if (!result.success) {
        throw result.error
      }
      emitChatRunActivity({
        chatSessionId,
        messageId: readChunkMessageId(result.value),
        chunk: result.value,
      })
      const terminalStatus = readTerminalChunkStatus(result.value)
      if (terminalStatus) {
        emitChatRunSettled({
          chatSessionId,
          messageId: readChunkMessageId(result.value),
          status: terminalStatus,
        })
      }
      controller.enqueue(result.value)
    },
  }))
}
