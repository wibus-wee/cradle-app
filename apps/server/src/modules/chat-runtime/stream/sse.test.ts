import { describe, expect, it } from 'vitest'

import { bindReadableStreamToAbortSignal, openBufferedChunkStream } from './sse'

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
})
