import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openSseEventStream, sseStreamPressureCounters } from './sse-event-stream'

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

  it('evicts by encoded byte size under drop-oldest', async () => {
    let emit!: (event: { id: number, pad: string }) => void
    const abortController = new AbortController()
    const dropped: number[] = []
    const stream = openSseEventStream({
      signal: abortController.signal,
      maxBufferedEvents: 16,
      maxBufferedBytes: 130,
      keepAliveMs: 60_000,
      onPressure: (info) => {
        if (info.kind === 'overflow-dropped') {
          dropped.push(1)
        }
      },
      source: {
        subscribe(nextListener) {
          emit = nextListener
          return () => {}
        },
      },
    })
    const reader = stream.getReader()

    for (let id = 1; id <= 4; id += 1) {
      emit({ id, pad: 'x'.repeat(40) })
    }

    await expect(readText(reader)).resolves.toBe(': cradle-event-stream-open\n\n')
    // Each encoded event is ~65 bytes; a 130-byte cap holds exactly two.
    const first = JSON.parse((await readText(reader)).slice('data: '.length))
    const second = JSON.parse((await readText(reader)).slice('data: '.length))
    expect(first.id).toBeGreaterThanOrEqual(3)
    expect(second.id).toBe(first.id + 1)
    expect(dropped.length).toBeGreaterThan(0)

    await reader.cancel()
    abortController.abort()
  })

  it('closes the stream on first overflow with the close policy', async () => {
    let emit!: (event: number) => void
    let unsubscribed = false
    const abortController = new AbortController()
    const pressures: string[] = []
    const stream = openSseEventStream({
      signal: abortController.signal,
      maxBufferedEvents: 2,
      overflow: 'close',
      keepAliveMs: 60_000,
      onPressure: (info) => {
        pressures.push(info.kind)
      },
      source: {
        subscribe(nextListener) {
          emit = nextListener
          return () => {
            unsubscribed = true
          }
        },
      },
    })
    const reader = stream.getReader()

    emit(1)
    emit(2)
    emit(3)

    await expect(readText(reader)).resolves.toBe(': cradle-event-stream-open\n\n')
    await expect(readText(reader)).resolves.toBe('data: 1\n\n')
    await expect(readText(reader)).resolves.toBe('data: 2\n\n')
    await expect(reader.read()).resolves.toMatchObject({ done: true })
    expect(unsubscribed).toBe(true)
    expect(pressures).toEqual(['overflow-closed'])

    abortController.abort()
  })

  describe('stall watchdog', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('closes a consumer that stays deeply behind without reading', async () => {
      let emit!: (event: number) => void
      let unsubscribed = false
      const abortController = new AbortController()
      const pressures: string[] = []
      const stream = openSseEventStream({
        signal: abortController.signal,
        keepAliveMs: 60_000,
        stallMs: 5_000,
        onPressure: (info) => {
          pressures.push(info.kind)
        },
        source: {
          subscribe(nextListener) {
            emit = nextListener
            return () => {
              unsubscribed = true
            }
          },
        },
      })
      const reader = stream.getReader()

      await expect(readText(reader)).resolves.toBe(': cradle-event-stream-open\n\n')
      for (let id = 0; id < 64; id += 1) {
        emit(id)
      }

      await vi.advanceTimersByTimeAsync(4_999)
      expect(unsubscribed).toBe(false)

      await vi.advanceTimersByTimeAsync(1_001)
      expect(unsubscribed).toBe(true)
      // Drain the chunks accepted before the stall close, then observe done.
      let drained = await reader.read()
      while (!drained.done) {
        drained = await reader.read()
      }
      expect(drained.done).toBe(true)
      expect(pressures).toEqual(['stall-closed'])
    })

    it('does not close a consumer that keeps up', async () => {
      let emit!: (event: number) => void
      let unsubscribed = false
      const abortController = new AbortController()
      const stream = openSseEventStream({
        signal: abortController.signal,
        keepAliveMs: 60_000,
        stallMs: 5_000,
        source: {
          subscribe(nextListener) {
            emit = nextListener
            return () => {
              unsubscribed = true
            }
          },
        },
      })
      const reader = stream.getReader()

      await expect(readText(reader)).resolves.toBe(': cradle-event-stream-open\n\n')

      for (let round = 0; round < 6; round += 1) {
        for (let id = 0; id < 64; id += 1) {
          emit(id)
        }
        for (let id = 0; id < 64; id += 1) {
          await readText(reader)
        }
        await vi.advanceTimersByTimeAsync(999)
      }
      await vi.advanceTimersByTimeAsync(10_000)
      expect(unsubscribed).toBe(false)

      await reader.cancel()
      abortController.abort()
    })
  })

  it('tracks payload-free pressure counters', async () => {
    const beforeDropped = sseStreamPressureCounters.droppedOldest
    let emit!: (event: number) => void
    const abortController = new AbortController()
    const stream = openSseEventStream({
      signal: abortController.signal,
      maxBufferedEvents: 1,
      keepAliveMs: 60_000,
      source: {
        subscribe(nextListener) {
          emit = nextListener
          return () => {}
        },
      },
    })
    const reader = stream.getReader()

    emit(1)
    emit(2)
    emit(3)
    expect(sseStreamPressureCounters.droppedOldest).toBeGreaterThanOrEqual(beforeDropped + 2)

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
