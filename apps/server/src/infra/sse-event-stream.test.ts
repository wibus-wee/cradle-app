import { describe, expect, it } from 'vitest'

import { openSseEventStream } from './sse-event-stream'

describe('openSseEventStream', () => {
  it('unsubscribes when the request aborts', async () => {
    let emit!: (event: { id: number }) => void
    let unsubscribed = false
    const abortController = new AbortController()
    const stream = openSseEventStream({
      signal: abortController.signal,
      source: {
        subscribe(nextListener) {
          emit = nextListener
          return () => {
            unsubscribed = true
          }
        },
      },
      keepAliveMs: 60_000,
    })
    const reader = stream.getReader()

    await expect(readText(reader)).resolves.toBe(': cradle-event-stream-open\n\n')
    emit({ id: 1 })
    await expect(readText(reader)).resolves.toBe('data: {"id":1}\n\n')

    abortController.abort()
    await expect(reader.read()).resolves.toMatchObject({ done: true })
    expect(unsubscribed).toBe(true)
  })

  it('keeps only a bounded number of unread events', async () => {
    let emit!: (event: number) => void
    const abortController = new AbortController()
    const stream = openSseEventStream({
      signal: abortController.signal,
      maxBufferedEvents: 2,
      keepAliveMs: 60_000,
      source: {
        subscribe(nextListener) {
          emit = nextListener
          return () => {
          }
        },
      },
    })
    const reader = stream.getReader()

    emit(1)
    emit(2)
    emit(3)

    await expect(readText(reader)).resolves.toBe(': cradle-event-stream-open\n\n')
    await expect(readText(reader)).resolves.toBe('data: 2\n\n')
    await expect(readText(reader)).resolves.toBe('data: 3\n\n')

    await reader.cancel()
    abortController.abort()
  })
})

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const value = await reader.read()
  if (value.done) {
    return ''
  }
  return new TextDecoder().decode(value.value)
}
