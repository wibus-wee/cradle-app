import type { UIMessageChunk } from 'ai'
import { uiMessageChunkSchema } from 'ai'

import type {
  DesktopChatStreamBridge,
  DesktopChatStreamChunkEvent,
  DesktopChatStreamClosedEvent,
  DesktopChatStreamErrorEvent,
  DesktopChatStreamHandle,
} from '~/lib/electron'
import { readDesktopChatStreamBridge } from '~/lib/electron'
import { isSyncSocketEnabled, subscribeSyncSessionRunChunks } from '~/lib/sync-socket'

import type { ChatResponseRequestBody } from '../commands/chat-response-command'
import { startChatResponse, subscribeChatSessionStream } from '../commands/chat-response-command'
import type { ChatStreamChunk } from './chat-stream-types'
import { liveChatStreamChunk, replayChatStreamChunk } from './chat-stream-types'
import {
  buildUIMessageChunkStreamFromResponse,
  emitChatRunActivity,
  emitChatRunSettled,
  readTerminalChunkStatus,
} from './sse-chat-transport'

export interface ChatStreamTransportResult {
  streamId: string | null
  sessionId: string
  runId: string | null
  assistantMessageId?: string
  userMessageId?: string
  stream: ReadableStream<ChatStreamChunk>
}

interface StartChatResponseStreamArgs {
  sessionId: string
  body: ChatResponseRequestBody
  signal?: AbortSignal
}

interface SubscribeChatSessionStreamArgs {
  sessionId: string
  signal?: AbortSignal
}

type BufferedDesktopEvent
  = | { kind: 'chunk', event: DesktopChatStreamChunkEvent }
    | { kind: 'closed', event: DesktopChatStreamClosedEvent }
    | { kind: 'error', event: DesktopChatStreamErrorEvent }

interface DesktopStreamState {
  controller: ReadableStreamDefaultController<ChatStreamChunk>
  bridge: DesktopChatStreamBridge
  streamId: string
  queue: Promise<void>
  closed: boolean
}

type UIMessageChunkValidationResult
  = | { success: true, value: UIMessageChunk }
    | { success: false, error: unknown }

interface UIMessageChunkValidator {
  validate?: (value: unknown) => UIMessageChunkValidationResult | PromiseLike<UIMessageChunkValidationResult>
}

const PENDING_DESKTOP_STREAM_LIMIT = 32
const PENDING_DESKTOP_EVENTS_PER_STREAM = 512
const CLOSED_DESKTOP_STREAM_LIMIT = 512

let desktopSubscriptions: Array<() => void> | null = null
const desktopStreams = new Map<string, DesktopStreamState>()
const pendingDesktopEvents = new Map<string, BufferedDesktopEvent[]>()
const closedDesktopStreamIds = new Set<string>()

export async function startChatResponseStream(
  args: StartChatResponseStreamArgs,
): Promise<ChatStreamTransportResult> {
  const bridge = readDesktopChatStreamBridge()
  if (bridge) {
    return await startDesktopChatResponseStream(bridge, args)
  }
  return await startHttpChatResponseStream(args)
}

export async function subscribeChatSessionStreamForSession(
  args: SubscribeChatSessionStreamArgs,
): Promise<ChatStreamTransportResult> {
  const bridge = readDesktopChatStreamBridge()
  if (bridge) {
    return await subscribeDesktopChatSessionStream(bridge, args)
  }
  if (isSyncSocketEnabled()) {
    return await subscribeSyncSessionRunChunks(args)
  }
  return await subscribeHttpChatSessionStream(args)
}

async function startHttpChatResponseStream(
  args: StartChatResponseStreamArgs,
): Promise<ChatStreamTransportResult> {
  const response = await startChatResponse(args)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Failed to start chat response: ${response.status} ${body}`)
  }
  return {
    streamId: null,
    sessionId: args.sessionId,
    runId: response.headers.get('x-cradle-run-id'),
    assistantMessageId: response.headers.get('x-cradle-assistant-message-id') ?? undefined,
    userMessageId: response.headers.get('x-cradle-user-message-id') ?? undefined,
    stream: buildUIMessageChunkStreamFromResponse(response, args.sessionId),
  }
}

async function subscribeHttpChatSessionStream(
  args: SubscribeChatSessionStreamArgs,
): Promise<ChatStreamTransportResult> {
  const response = await subscribeChatSessionStream(args)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Failed to subscribe chat session stream: ${response.status} ${body}`)
  }
  return {
    streamId: null,
    sessionId: args.sessionId,
    runId: response.headers.get('x-cradle-run-id'),
    stream: buildUIMessageChunkStreamFromResponse(response, args.sessionId, { initialReplay: true }),
  }
}

async function startDesktopChatResponseStream(
  bridge: DesktopChatStreamBridge,
  args: StartChatResponseStreamArgs,
): Promise<ChatStreamTransportResult> {
  activateDesktopEventBridge(bridge)
  throwIfAborted(args.signal)
  const handle = await bridge.startResponse({
    sessionId: args.sessionId,
    body: args.body,
  })
  return readDesktopTransportResult(bridge, handle, args.signal)
}

async function subscribeDesktopChatSessionStream(
  bridge: DesktopChatStreamBridge,
  args: SubscribeChatSessionStreamArgs,
): Promise<ChatStreamTransportResult> {
  activateDesktopEventBridge(bridge)
  throwIfAborted(args.signal)
  const handle = await bridge.subscribeSession({ sessionId: args.sessionId })
  return readDesktopTransportResult(bridge, handle, args.signal)
}

function activateDesktopEventBridge(bridge: DesktopChatStreamBridge): void {
  if (desktopSubscriptions) {
    return
  }
  desktopSubscriptions = [
    bridge.onChunk(event => routeDesktopEvent({ kind: 'chunk', event })),
    bridge.onClosed(event => routeDesktopEvent({ kind: 'closed', event })),
    bridge.onError(event => routeDesktopEvent({ kind: 'error', event })),
  ]
}

function readDesktopTransportResult(
  bridge: DesktopChatStreamBridge,
  handle: DesktopChatStreamHandle,
  signal: AbortSignal | undefined,
): ChatStreamTransportResult {
  closedDesktopStreamIds.delete(handle.streamId)
  const stream = new ReadableStream<ChatStreamChunk>({
    start(controller) {
      const state: DesktopStreamState = {
        controller,
        bridge,
        streamId: handle.streamId,
        queue: Promise.resolve(),
        closed: false,
      }
      desktopStreams.set(handle.streamId, state)
      replayPendingDesktopEvents(handle.streamId)
      if (signal?.aborted) {
        abortDesktopStream(state)
      }
      signal?.addEventListener('abort', () => abortDesktopStream(state), { once: true })
    },
    cancel() {
      const state = desktopStreams.get(handle.streamId)
      if (state) {
        abortDesktopStream(state)
      }
    },
  })

  return {
    streamId: handle.streamId,
    sessionId: handle.sessionId,
    runId: handle.runId,
    assistantMessageId: handle.assistantMessageId,
    userMessageId: handle.userMessageId,
    stream,
  }
}

function replayPendingDesktopEvents(streamId: string): void {
  const events = pendingDesktopEvents.get(streamId)
  if (!events) {
    return
  }
  pendingDesktopEvents.delete(streamId)
  for (const event of events) {
    routeDesktopEvent(event)
  }
}

function routeDesktopEvent(event: BufferedDesktopEvent): void {
  const streamId = readDesktopEventStreamId(event)
  if (closedDesktopStreamIds.has(streamId)) {
    return
  }
  const state = desktopStreams.get(streamId)
  if (!state) {
    bufferPendingDesktopEvent(streamId, event)
    return
  }

  state.queue = state.queue.then(async () => {
    if (state.closed) {
      return
    }
    if (event.kind === 'chunk') {
      const schema = uiMessageChunkSchema() as unknown as UIMessageChunkValidator
      if (!schema.validate) {
        closeDesktopStreamWithError(state, new Error('AI SDK UIMessageChunk schema is unavailable'))
        return
      }
      const result = await schema.validate(event.event.chunk)
      if (!result.success) {
        closeDesktopStreamWithError(state, result.error)
        return
      }
      emitChatRunActivity({
        chatSessionId: event.event.sessionId,
        messageId: readChunkMessageId(result.value),
        chunk: result.value,
      })
      const terminalStatus = readTerminalChunkStatus(result.value)
      if (terminalStatus) {
        emitChatRunSettled({
          chatSessionId: event.event.sessionId,
          messageId: readChunkMessageId(result.value),
          status: terminalStatus,
        })
      }
      state.controller.enqueue(event.event.replay ? replayChatStreamChunk(result.value) : liveChatStreamChunk(result.value))
      return
    }
    if (event.kind === 'closed') {
      state.closed = true
      desktopStreams.delete(streamId)
      recordClosedDesktopStream(streamId)
      pendingDesktopEvents.delete(streamId)
      state.controller.close()
      return
    }
    closeDesktopStreamWithError(state, new Error(event.event.message))
  })
}

function abortDesktopStream(state: DesktopStreamState): void {
  if (state.closed) {
    return
  }
  state.closed = true
  desktopStreams.delete(state.streamId)
  recordClosedDesktopStream(state.streamId)
  pendingDesktopEvents.delete(state.streamId)
  void state.bridge.abort({ streamId: state.streamId })
  state.controller.error(createAbortError())
}

function closeDesktopStreamWithError(state: DesktopStreamState, error: unknown): void {
  if (state.closed) {
    return
  }
  state.closed = true
  desktopStreams.delete(state.streamId)
  recordClosedDesktopStream(state.streamId)
  pendingDesktopEvents.delete(state.streamId)
  state.controller.error(error instanceof Error ? error : new Error('Desktop chat stream failed'))
}

function bufferPendingDesktopEvent(streamId: string, event: BufferedDesktopEvent): void {
  const pending = pendingDesktopEvents.get(streamId) ?? []
  pending.push(event)
  if (pending.length > PENDING_DESKTOP_EVENTS_PER_STREAM) {
    pending.splice(0, pending.length - PENDING_DESKTOP_EVENTS_PER_STREAM)
  }
  pendingDesktopEvents.delete(streamId)
  pendingDesktopEvents.set(streamId, pending)
  trimPendingDesktopStreams()
}

function trimPendingDesktopStreams(): void {
  while (pendingDesktopEvents.size > PENDING_DESKTOP_STREAM_LIMIT) {
    const oldestStreamId = pendingDesktopEvents.keys().next().value
    if (typeof oldestStreamId !== 'string') {
      return
    }
    pendingDesktopEvents.delete(oldestStreamId)
  }
}

function recordClosedDesktopStream(streamId: string): void {
  closedDesktopStreamIds.delete(streamId)
  closedDesktopStreamIds.add(streamId)
  while (closedDesktopStreamIds.size > CLOSED_DESKTOP_STREAM_LIMIT) {
    const oldestStreamId = closedDesktopStreamIds.values().next().value
    if (typeof oldestStreamId !== 'string') {
      return
    }
    closedDesktopStreamIds.delete(oldestStreamId)
  }
}

function readDesktopEventStreamId(event: BufferedDesktopEvent): string {
  return event.event.streamId
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

export function disposeChatStreamTransport(): void {
  if (desktopSubscriptions) {
    for (const unsubscribe of desktopSubscriptions) {
      unsubscribe()
    }
    desktopSubscriptions = null
  }
  for (const state of desktopStreams.values()) {
    if (!state.closed) {
      state.closed = true
      state.controller.error(createAbortError())
    }
  }
  desktopStreams.clear()
  pendingDesktopEvents.clear()
  closedDesktopStreamIds.clear()
}

function createAbortError(): DOMException {
  return new DOMException('Chat stream aborted', 'AbortError')
}
