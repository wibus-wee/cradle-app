import type { UIMessage, UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { consumeChatMessageStream, createUIMessageChunkStream } from './chat-stream'

function streamResponse(source: string, boundaries: number[]): Response {
  const bytes = new TextEncoder().encode(source)
  let offset = 0
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const size = boundaries.shift() ?? bytes.length
      controller.enqueue(bytes.slice(offset, offset + size))
      offset += size
    },
  }))
}

describe('mobile chat stream', () => {
  it('parses fragmented SSE frames and ignores stream comments', async () => {
    const response = streamResponse([
      ': cradle-stream-open\r\n\r\n',
      'data: {"type":"start","messageId":"assistant-1"}\r\n\r\n',
      'data: {"type":"text-start","id":"text-1"}\n\n',
      'data: {"type":"text-delta","id":"text-1","delta":"你好"}\n\n',
      'data: [DONE]\n\n',
    ].join(''), [1, 2, 7, 3, 11, 5, 13])
    const chunks: UIMessageChunk[] = []
    const reader = createUIMessageChunkStream(response).getReader()
    while (true) {
      const next = await reader.read()
      if (next.done) { break }
      chunks.push(next.value)
    }

    expect(chunks).toEqual([
      { type: 'start', messageId: 'assistant-1' },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: '你好' },
    ])
  })

  it('projects text deltas into the active assistant message', async () => {
    const response = streamResponse([
      'data: {"type":"start","messageId":"assistant-1"}\n\n',
      'data: {"type":"text-start","id":"text-1"}\n\n',
      'data: {"type":"text-delta","id":"text-1","delta":"Hello"}\n\n',
      'data: {"type":"text-delta","id":"text-1","delta":" world"}\n\n',
      'data: {"type":"text-end","id":"text-1"}\n\n',
      'data: {"type":"finish","finishReason":"stop"}\n\n',
      'data: [DONE]\n\n',
    ].join(''), [9, 4, 17, 6])
    const messages: UIMessage[] = []

    await consumeChatMessageStream({
      messageId: 'temporary',
      onMessage: message => messages.push(message),
      response,
    })

    expect(messages.at(-1)).toMatchObject({
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello world', state: 'done' }],
    })
  })
})
