import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  readChronicleDownloadProgressMessage,
  useChronicleDownloadProgress,
} from './use-chronicle'

vi.mock('~/lib/electron', () => ({
  getAuthenticatedEventSourceUrl: async (url: string) => url,
  getServerUrl: () => 'http://127.0.0.1:4100',
}))

type EventSourceMessageHandler = ((event: MessageEvent<string>) => void) | null

class FakeEventSource {
  static instances: FakeEventSource[] = []

  onmessage: EventSourceMessageHandler = null
  onerror: ((event: Event) => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  emit(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  close(): void {
    this.closed = true
  }
}

describe('chronicle download progress', () => {
  const originalEventSource = globalThis.EventSource

  afterEach(() => {
    globalThis.EventSource = originalEventSource
    FakeEventSource.instances = []
    vi.restoreAllMocks()
  })

  it('parses single and batched download progress messages', () => {
    const single = readChronicleDownloadProgressMessage(JSON.stringify({
      category: 'audio-asr',
      file: 'model.bin',
      downloadedBytes: 12,
      status: 'downloading',
      startedAt: 1,
    }))
    const batch = readChronicleDownloadProgressMessage(JSON.stringify([
      {
        category: 'audio-asr',
        file: 'model.bin',
        downloadedBytes: 24,
        status: 'done',
        startedAt: 1,
      },
    ]))

    expect(single).toEqual([{
      category: 'audio-asr',
      file: 'model.bin',
      totalBytes: null,
      downloadedBytes: 12,
      status: 'downloading',
      startedAt: 1,
    }])
    expect(batch[0]?.status).toBe('done')
  })

  it('updates progress from EventSource frames and closes on cleanup', async () => {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useChronicleDownloadProgress(true))

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const eventSource = FakeEventSource.instances[0]!
    expect(eventSource?.url).toBe('http://127.0.0.1:4100/chronicle/model-resources/download-progress')

    act(() => {
      eventSource.emit('not-json')
      eventSource.emit('not-json-again')
      eventSource.emit(JSON.stringify({
        category: 'audio-asr',
        file: 'model.bin',
        downloadedBytes: 12,
        status: 'downloading',
        startedAt: 1,
      }))
    })

    expect(warning).toHaveBeenCalledTimes(1)
    expect(result.current.get('audio-asr/model.bin')).toMatchObject({
      downloadedBytes: 12,
      status: 'downloading',
    })

    unmount()
    expect(eventSource.closed).toBe(true)
  })

  it('clears progress and avoids EventSource when inactive', async () => {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    const { result, rerender } = renderHook(
      ({ active }) => useChronicleDownloadProgress(active),
      { initialProps: { active: true } },
    )

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => {
      FakeEventSource.instances[0]?.emit(JSON.stringify({
        category: 'audio-asr',
        file: 'model.bin',
        downloadedBytes: 12,
        status: 'downloading',
        startedAt: 1,
      }))
    })
    expect(result.current.size).toBe(1)

    rerender({ active: false })

    expect(result.current.size).toBe(0)
    expect(FakeEventSource.instances).toHaveLength(1)
  })
})
