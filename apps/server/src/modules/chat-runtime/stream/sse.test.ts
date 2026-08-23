import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bindReadableStreamToAbortSignal, openBufferedChunkStream } from './sse'
import type { ChunkSubscriber } from './subscriber-registry'

describe('bindReadableStreamToAbortSignal', () => {
  it('cancels the source stream when the abort signal fires', async () => {
    const abortController = new AbortController()
    let cancelled = false
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
      cancel() {
        cancelled = true
      },
    })

    const reader = bindReadableStreamToAbortSignal(source, abortController.signal).getReader()
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: new Uint8Array([1]),
    })

    const pendingRead = reader.read()
    abortController.abort()

    await expect(pendingRead).rejects.toMatchObject({ name: 'AbortError' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(cancelled).toBe(true)
  })
})

describe('openBufferedChunkStream', () => {
  it('emits an initial SSE comment before any chat chunks are available', async () => {
    const stream = openBufferedChunkStream({
      replayChunks: [],
      coalesceMaxChars: 8_192,
      subscribe: () => () => {},
    })

    const reader = stream.getReader()
    const result = await reader.read()

    expect(result).toEqual({
      done: false,
      value: new TextEncoder().encode(': cradle-stream-open\n\n'),
    })

    await reader.cancel()
  })

  it('delivers replay chunks, replay-end, and a terminal [DONE] frame', async () => {
    const stream = openBufferedChunkStream({
      replayChunks: [
        { type: 'start', messageId: 'm1' },
        { type: 'finish', finishReason: 'stop' },
      ],
      terminal: true,
      coalesceMaxChars: 8_192,
      subscribe: () => () => {},
    })

    const reader = stream.getReader()
    const texts: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const { value } = await reader.read()
      texts.push(new TextDecoder().decode(value))
    }
    await expect(reader.read()).resolves.toMatchObject({ done: true })

    expect(texts[0]).toBe(': cradle-stream-open\n\n')
    expect(texts[1]).toContain('"type":"start"')
    // A terminal chunk during replay ends the stream directly; no replay-end.
    expect(texts[2]).toContain('"type":"finish"')
    expect(texts.at(-1)).toBe('data: [DONE]\n\n')
  })

  it('ends the stream cleanly when the backlog overflows (close policy)', async () => {
    let emit!: ChunkSubscriber
    let unsubscribed = false
    const stream = openBufferedChunkStream({
      replayChunks: [],
      coalesceMaxChars: 8_192,
      maxBufferedEvents: 2,
      subscribe: (subscriber) => {
        emit = subscriber
        return () => {
          unsubscribed = true
        }
      },
    })
    const reader = stream.getReader()

    await reader.read() // open comment
    for (let i = 0; i < 10; i += 1) {
      emit({ type: 'source-url', sourceId: `s-${i}`, url: `https://example.com/${i}` }, false)
    }

    // The backlog was dropped at overflow; the first queued frame(s) may
    // still flush, but the stream ends well before all 10 chunks and the
    // client recovers through cursor + snapshot reconnect.
    let drained = await reader.read()
    let frames = drained.done ? 0 : 1
    while (!drained.done && frames < 10) {
      drained = await reader.read()
      if (!drained.done) {
        frames += 1
      }
    }
    expect(drained.done).toBe(true)
    expect(frames).toBeLessThan(10)
    expect(unsubscribed).toBe(true)
  })

  it('keeps a single oversized chunk (recovery snapshot) deliverable', async () => {
    const bigChunk: UIMessageChunk = {
      type: 'source-url',
      sourceId: 'big',
      url: `https://example.com/${'x'.repeat(4096)}`,
    }
    const stream = openBufferedChunkStream({
      replayChunks: [bigChunk],
      coalesceMaxChars: 8_192,
      maxBufferedBytes: 64,
      subscribe: () => () => {},
    })
    const reader = stream.getReader()

    await expect(readText(reader)).resolves.toBe(': cradle-stream-open\n\n')
    await expect(readText(reader)).resolves.toContain('"type":"source-url"')
    await expect(readText(reader)).resolves.toBe(': cradle-replay-end\n\n')

    await reader.cancel()
  })
})

describe('openBufferedChunkStream stall watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes the stream when the consumer stalls with buffered events', async () => {
    let emit!: ChunkSubscriber
    const stream = openBufferedChunkStream({
      replayChunks: [],
      coalesceMaxChars: 8_192,
      stallMs: 5_000,
      subscribe: (subscriber) => {
        emit = subscriber
        return () => {}
      },
    })
    const reader = stream.getReader()

    await readText(reader)
    for (let i = 0; i < 8; i += 1) {
      emit({ type: 'source-url', sourceId: `stall-${i}`, url: `https://example.com/stall-${i}` }, false)
    }

    await vi.advanceTimersByTimeAsync(5_500)
    let drained = await reader.read()
    while (!drained.done) {
      drained = await reader.read()
    }
    expect(drained.done).toBe(true)
  })
})

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const value = await reader.read()
  if (value.done) {
    return ''
  }
  return new TextDecoder().decode(value.value)
}
