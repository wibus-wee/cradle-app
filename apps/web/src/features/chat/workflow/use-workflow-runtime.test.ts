// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useWorkflowRuntime } from './use-workflow-runtime'

const { openServerEventSource } = vi.hoisted(() => ({
  openServerEventSource: vi.fn(),
}))

vi.mock('~/lib/electron', () => ({
  getServerUrl: () => 'http://localhost:21423',
}))

vi.mock('~/lib/server-transport', () => ({
  openServerEventSource,
}))

const eventSources: MockEventSource[] = []

class MockEventSource {
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  closed = false

  constructor(readonly url: string) {
    eventSources.push(this)
  }

  close(): void {
    this.closed = true
  }
}

afterEach(() => {
  eventSources.length = 0
  openServerEventSource.mockReset()
})

describe('useWorkflowRuntime', () => {
  it('shares one EventSource and closes it after the final subscriber leaves', async () => {
    openServerEventSource.mockImplementation((url: string) => new MockEventSource(url))
    const first = renderHook(() => useWorkflowRuntime('session-1', 'tool-1'))
    const second = renderHook(() => useWorkflowRuntime('session-1', 'tool-1'))

    await waitFor(() => expect(eventSources).toHaveLength(1))
    expect(eventSources[0]?.url).toContain('/chat/sessions/session-1/workflows/tool-1/stream')

    first.unmount()
    expect(eventSources[0]?.closed).toBe(false)
    second.unmount()
    expect(eventSources[0]?.closed).toBe(true)
  })
})
