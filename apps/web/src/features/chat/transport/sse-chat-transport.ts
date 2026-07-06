import type { UIMessageChunk } from 'ai'
import { uiMessageChunkSchema } from 'ai'

import type { ChatStreamChunk } from './chat-stream-types'
import { liveChatStreamChunk, replayChatStreamChunk } from './chat-stream-types'

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
type UIMessageChunkValidationResult
  = | { success: true, value: UIMessageChunk }
    | { success: false, error: unknown }

interface UIMessageChunkValidator {
  validate?: (value: unknown) => UIMessageChunkValidationResult | PromiseLike<UIMessageChunkValidationResult>
}

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
  options: { initialReplay?: boolean } = {},
): ReadableStream<ChatStreamChunk> {
  if (!response.body) {
    throw new Error('SSE stream has no body')
  }

  return parseChatChunkEventStream(response.body, options.initialReplay ?? false)
    .pipeThrough(new TransformStream<ChatStreamChunk, ChatStreamChunk>({
      transform(item, controller) {
        emitChatRunActivity({
          chatSessionId,
          messageId: readChunkMessageId(item.chunk),
          chunk: item.chunk,
        })
        const terminalStatus = readTerminalChunkStatus(item.chunk)
        if (terminalStatus) {
          emitChatRunSettled({
            chatSessionId,
            messageId: readChunkMessageId(item.chunk),
            status: terminalStatus,
          })
        }
        controller.enqueue(item)
      },
    }))
}

function parseChatChunkEventStream(
  stream: ReadableStream<Uint8Array>,
  initialReplay: boolean,
): ReadableStream<ChatStreamChunk> {
  const schema = uiMessageChunkSchema() as unknown as UIMessageChunkValidator
  if (!schema.validate) {
    throw new Error('AI SDK UIMessageChunk schema is unavailable')
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let replay = initialReplay

  return new ReadableStream<ChatStreamChunk>({
    async pull(controller) {
      while (true) {
        const frame = readCompleteSseFrame()
        if (frame) {
          const result = await processSseFrame(frame, schema, replay)
          replay = result.replay
          if (result.kind === 'skip') {
            continue
          }
          if (result.kind === 'done') {
            controller.close()
            await reader.cancel().catch(() => undefined)
            return
          }
          controller.enqueue(result.item)
          return
        }

        const next = await reader.read()
        if (next.done) {
          buffer += decoder.decode()
          const finalFrame = buffer.trim() ? buffer : null
          buffer = ''
          if (finalFrame) {
            const result = await processSseFrame(finalFrame, schema, replay)
            replay = result.replay
            if (result.kind === 'item') {
              controller.enqueue(result.item)
              return
            }
          }
          controller.close()
          return
        }
        buffer += decoder.decode(next.value, { stream: true })
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined)
    },
  })

  function readCompleteSseFrame(): string | null {
    const normalized = buffer.replace(/\r\n/g, '\n')
    const idx = normalized.indexOf('\n\n')
    if (idx === -1) {
      return null
    }
    const frame = normalized.slice(0, idx)
    buffer = normalized.slice(idx + 2)
    return frame
  }
}

async function processSseFrame(
  frame: string,
  schema: UIMessageChunkValidator,
  replay: boolean,
): Promise<
  | { kind: 'skip', replay: boolean }
  | { kind: 'done', replay: boolean }
  | { kind: 'item', replay: boolean, item: ChatStreamChunk }
> {
  const boundary = readSseReplayBoundary(frame)
  if (boundary) {
    return { kind: 'skip', replay: false }
  }

  const data = readSseData(frame)
  if (data === null) {
    return { kind: 'skip', replay }
  }
  if (data === '[DONE]') {
    return { kind: 'done', replay }
  }

  const parsed = JSON.parse(data) as unknown
  const chunkInput = readChunkPayload(parsed)
  const result = await schema.validate!(chunkInput.chunk)
  if (!result.success) {
    throw result.error
  }
  const itemReplay = chunkInput.replay ?? replay
  return {
    kind: 'item',
    replay,
    item: itemReplay ? replayChatStreamChunk(result.value) : liveChatStreamChunk(result.value),
  }
}

function readSseReplayBoundary(frame: string): boolean {
  return frame
    .split('\n')
    .some(line => line.trim() === ': cradle-replay-end')
}

function readSseData(frame: string): string | null {
  const lines = frame.split('\n')
  const dataLines = lines.flatMap((line) => {
    if (!line.startsWith('data:')) {
      return []
    }
    const value = line.slice('data:'.length)
    return [value.startsWith(' ') ? value.slice(1) : value]
  })
  return dataLines.length > 0 ? dataLines.join('\n') : null
}

function readChunkPayload(value: unknown): { chunk: unknown, replay?: boolean } {
  if (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'chunk' in value
  ) {
    const replay = (value as { replay?: unknown }).replay
    return {
      chunk: (value as { chunk: unknown }).chunk,
      replay: typeof replay === 'boolean'
        ? replay
        : undefined,
    }
  }
  return { chunk: value }
}
