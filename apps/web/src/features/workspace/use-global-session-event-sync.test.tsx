// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GlobalSessionEventSource } from './global-session-sync-engine'
import { useGlobalSessionEventSync } from './use-global-session-event-sync'
import { SESSION_LIST_REFRESH_INTERVAL_MS } from './use-session'

const transportMocks = vi.hoisted(() => ({
  createGlobalSessionEventSource: vi.fn(),
}))

vi.mock('~/features/chat/transport/chat-event-tail-transport', () => transportMocks)
vi.mock('~/lib/electron', () => ({
  getServerUrl: () => 'http://127.0.0.1:21423',
}))

class FakeEventSource implements GlobalSessionEventSource {
  private readonly sessionListeners = new Set<(event: MessageEvent<string>) => void>()
  private readonly errorListeners = new Set<(event: Event) => void>()

  addEventListener(type: 'sessions', listener: (event: MessageEvent<string>) => void): void
  addEventListener(type: 'error', listener: (event: Event) => void): void
  addEventListener(type: 'sessions' | 'error', listener: ((event: MessageEvent<string>) => void) | ((event: Event) => void)): void {
    if (type === 'sessions') {
      this.sessionListeners.add(listener as (event: MessageEvent<string>) => void)
      return
    }
    this.errorListeners.add(listener as (event: Event) => void)
  }

  close(): void {
    this.sessionListeners.clear()
    this.errorListeners.clear()
  }

  emitSessionChanged(sequenceId: number): void {
    const message = new MessageEvent('sessions', {
      data: JSON.stringify({
        scope: 'sessions',
        sessionId: 'session-1',
        sequenceId,
        version: sequenceId,
        type: 'RunCompleted',
        occurredAt: 100 + sequenceId,
        payload: { runId: 'run-1' },
      }),
    })
    for (const listener of this.sessionListeners) {
      listener(message)
    }
  }
}

function Probe({ queryClient }: { queryClient: QueryClient }) {
  useGlobalSessionEventSync(queryClient)
  return null
}

describe('useGlobalSessionEventSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('polls session lists every five seconds and restarts the delay after an event', async () => {
    const source = new FakeEventSource()
    transportMocks.createGlobalSessionEventSource.mockReturnValue(source)
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const countSessionListInvalidations = () =>
      invalidateQueries.mock.calls.filter(([filters]) => filters?.predicate).length

    render(<Probe queryClient={queryClient} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_LIST_REFRESH_INTERVAL_MS)
    })
    expect(countSessionListInvalidations()).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
      source.emitSessionChanged(1)
    })
    expect(countSessionListInvalidations()).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_LIST_REFRESH_INTERVAL_MS - 1)
    })
    expect(countSessionListInvalidations()).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(countSessionListInvalidations()).toBe(3)
  })
})
