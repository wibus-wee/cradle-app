// @vitest-environment node
// Prefer: pnpm exec vitest run --config vitest.transport.config.ts <this-file>

import { afterEach, describe, expect, it, vi } from 'vitest'

import { openServerEventSource } from './fetch-event-source'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  let index = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[index]))
      index += 1
    },
  })
  return new Response(stream, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('fetch-backed SSE adapter', () => {
  it('parses CRLF frames, named events, and multiline data', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      'event: session\r\n',
      'data: {"hello":"world"}\r\n',
      'data: line-two\r\n',
      'id: 7\r\n',
      '\r\n',
      ': heartbeat\n',
      'data: plain\n',
      '\n',
    ]))

    const source = openServerEventSource('http://server.test/events', {
      fetch: fetchMock,
      shouldReconnect: () => false,
    })

    const named = new Promise<MessageEvent<string>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for session event')), 3_000)
      source.addEventListener('session', (event) => {
        clearTimeout(timer)
        resolve(event as MessageEvent<string>)
      })
    })
    const messages: string[] = []
    source.onmessage = (event) => {
      messages.push(event.data)
    }

    const sessionEvent = await named
    expect(sessionEvent.data).toBe('{"hello":"world"}\nline-two')
    await vi.waitFor(() => expect(messages).toContain('plain'), { timeout: 3_000 })
    source.close()
  })

  it('aborts and does not reconnect after close', async () => {
    let pullCount = 0
    const fetchMock = vi.fn(async () => {
      pullCount += 1
      // Keep the body open so close() aborts mid-stream (no natural end reconnect race).
      return new Response(new ReadableStream({
        start() {
          // never enqueues; aborted by signal
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    })

    const source = openServerEventSource('http://server.test/events', {
      fetch: fetchMock,
      reconnectDelayMs: 10,
      shouldReconnect: () => true,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3_000 })
    source.close()
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(pullCount).toBe(1)
  })
})
