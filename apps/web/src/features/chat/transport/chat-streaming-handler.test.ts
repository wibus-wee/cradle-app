import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { chatSelectors, useChatStore } from '~/store/chat'
import { useRendererChatStore } from '~/store/renderer-chat'

import type { ChatStreamChunk } from './chat-stream-types'
import { liveChatStreamChunk, replayChatStreamChunk } from './chat-stream-types'
import { ChatStreamingHandler } from './chat-streaming-handler'
import { buildUIMessageChunkStreamFromResponse, disposeChatRunBroadcast, onChatRunSettled } from './sse-chat-transport'

function resetChatStore(store: typeof useChatStore): void {
  store.setState(state => ({
    ...state,
    messagesMap: new Map(),
    hydratedSessionIds: new Set(),
    runStateMap: new Map(),
    streamLeaseMap: new Map(),
    activeAbortControllers: new Map(),
    runDisplayMetaMap: new Map(),
    errorMap: new Map(),
    assistantDisplaySplitMap: new Map(),
  }))
}

function createChunkStream(chunks: UIMessageChunk[], replay = false): ReadableStream<ChatStreamChunk> {
  return new ReadableStream<ChatStreamChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(replay ? replayChatStreamChunk(chunk) : liveChatStreamChunk(chunk))
      }
      controller.close()
    },
  })
}

const assistantTextChunks: UIMessageChunk[] = [
  { type: 'start', messageId: 'assistant-stream' },
  { type: 'text-start', id: 'text-1' },
  { type: 'text-delta', id: 'text-1', delta: 'Hello' },
  { type: 'text-end', id: 'text-1' },
  { type: 'finish', finishReason: 'stop' },
]

describe('chat streaming handler store boundary', () => {
  beforeEach(() => {
    resetChatStore(useChatStore)
    resetChatStore(useRendererChatStore)
    disposeChatRunBroadcast()
  })

  afterEach(() => {
    disposeChatRunBroadcast()
  })

  it('writes chunk output to the injected renderer store without touching the main store', async () => {
    const settledEvents: unknown[] = []
    const unsubscribe = onChatRunSettled(event => settledEvents.push(event))
    const handler = new ChatStreamingHandler('side:side-conversation-1', 'assistant-local', 0, {
      store: useRendererChatStore,
      emitSettledEvents: false,
    })

    handler.start(new AbortController())
    await handler.consume(createChunkStream(assistantTextChunks))
    handler.finish()
    unsubscribe()

    const rendererMessages = chatSelectors.messages('side:side-conversation-1')(useRendererChatStore.getState())

    expect(rendererMessages).toHaveLength(1)
    expect(rendererMessages[0]).toMatchObject({
      id: 'assistant-stream',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello', state: 'done' }],
    })
    expect(chatSelectors.isVisibleStreamingMessage('side:side-conversation-1', 'assistant-stream')(useRendererChatStore.getState())).toBe(false)
    expect(useChatStore.getState().messagesMap.has('side:side-conversation-1')).toBe(false)
    expect(settledEvents).toEqual([])
  })

  it('emits settled events for the default main chat store path', () => {
    const settledEvents: unknown[] = []
    const unsubscribe = onChatRunSettled(event => settledEvents.push(event))
    const handler = new ChatStreamingHandler('session-1', 'assistant-1', 0)

    handler.start(new AbortController())
    handler.finish()
    unsubscribe()

    expect(settledEvents).toEqual([{
      chatSessionId: 'session-1',
      messageId: 'assistant-1',
      status: 'complete',
    }])
  })

  it('applies replay chunks as a single store update when replay catches up', async () => {
    let resolveStreamController!: (controller: ReadableStreamDefaultController<ChatStreamChunk>) => void
    const streamControllerPromise = new Promise<ReadableStreamDefaultController<ChatStreamChunk>>((resolve) => {
      resolveStreamController = resolve
    })
    const stream = new ReadableStream<ChatStreamChunk>({
      start(nextController) {
        resolveStreamController(nextController)
      },
    })
    const handler = new ChatStreamingHandler('session-1', 'assistant-local', 0)

    handler.start(new AbortController())
    const consumePromise = handler.consume(stream)
    const streamController = await streamControllerPromise

    for (const chunk of assistantTextChunks) {
      streamController.enqueue(replayChatStreamChunk(chunk))
    }
    await Promise.resolve()

    expect(chatSelectors.messages('session-1')(useChatStore.getState())[0]?.parts).toEqual([])

    streamController.close()
    await consumePromise
    handler.finish()

    expect(chatSelectors.messages('session-1')(useChatStore.getState())[0]).toMatchObject({
      id: 'assistant-stream',
      parts: [{ type: 'text', text: 'Hello', state: 'done' }],
    })
  })

  it('marks HTTP stream chunks before the replay boundary as replay', async () => {
    const encoder = new TextEncoder()
    const response = new Response(encoder.encode([
      'data: {"type":"start","messageId":"assistant-stream"}\n\n',
      'data: {"type":"text-start","id":"text-1"}\n\n',
      ': cradle-replay-end\n\n',
      'data: {"type":"text-delta","id":"text-1","delta":"Live"}\n\n',
      'data: [DONE]\n\n',
    ].join('')))

    const reader = buildUIMessageChunkStreamFromResponse(response, 'session-1', { initialReplay: true }).getReader()
    const items: ChatStreamChunk[] = []
    while (true) {
      const result = await reader.read()
      if (result.done) {
        break
      }
      items.push(result.value)
    }

    expect(items.map(item => item.replay)).toEqual([true, true, false])
  })
})
