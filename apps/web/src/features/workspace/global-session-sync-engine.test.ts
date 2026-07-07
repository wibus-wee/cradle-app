import { describe, expect, it, vi } from 'vitest'

import type { GlobalSessionEventSource } from './global-session-sync-engine'
import {
  buildGlobalSessionEventTailUrl,
  GlobalSessionSyncEngine,
} from './global-session-sync-engine'

class FakeEventSource implements GlobalSessionEventSource {
  readonly listeners = new Map<string, Array<(event: MessageEvent<string> | Event) => void>>()
  closed = false

  addEventListener(type: 'sessions', listener: (event: MessageEvent<string>) => void): void
  addEventListener(type: 'error', listener: (event: Event) => void): void
  addEventListener(type: 'sessions' | 'error', listener: ((event: MessageEvent<string>) => void) | ((event: Event) => void)): void {
    const current = this.listeners.get(type) ?? []
    current.push(listener as (event: MessageEvent<string> | Event) => void)
    this.listeners.set(type, current)
  }

  close(): void {
    this.closed = true
  }

  emitSessions(data: unknown): void {
    for (const listener of this.listeners.get('sessions') ?? []) {
      listener(new MessageEvent('sessions', { data: JSON.stringify(data) }))
    }
  }

  emitError(): void {
    for (const listener of this.listeners.get('error') ?? []) {
      listener(new Event('error'))
    }
  }
}

describe('globalSessionSyncEngine', () => {
  it('builds a global sessions event tail URL', () => {
    expect(buildGlobalSessionEventTailUrl({
      serverBaseUrl: 'http://127.0.0.1:21423',
      afterSequenceId: 9,
      workspaceId: 'workspace-1',
    })).toBe('http://127.0.0.1:21423/events?scope=sessions&afterSequenceId=9&workspaceId=workspace-1')
  })

  it('maps global session events to directed invalidation callbacks and ignores duplicates', () => {
    const source = new FakeEventSource()
    const onSessionChanged = vi.fn()
    const onSnapshotRequired = vi.fn()
    const engine = new GlobalSessionSyncEngine({
      serverBaseUrl: 'http://127.0.0.1:21423',
      eventSourceFactory: () => source,
      callbacks: {
        onSessionChanged,
        onSnapshotRequired,
      },
    })

    engine.start()
    source.emitSessions({
      scope: 'sessions',
      sessionId: 'session-1',
      sequenceId: 1,
      version: 1,
      type: 'RunStarted',
      occurredAt: 100,
      payload: { runId: 'run-1', assistantMessageId: 'assistant-1', queueItemId: null },
    })
    source.emitSessions({
      scope: 'sessions',
      sessionId: 'session-1',
      sequenceId: 1,
      version: 1,
      type: 'RunStarted',
      occurredAt: 100,
      payload: { runId: 'run-1', assistantMessageId: 'assistant-1', queueItemId: null },
    })
    source.emitSessions({
      scope: 'sessions',
      sessionId: 'session-1',
      sequenceId: 2,
      version: 2,
      type: 'InteractionResolved',
      occurredAt: 101,
      payload: {
        runId: 'run-1',
        requestId: 'approval-1',
        interactionKind: 'toolApproval',
        resolution: 'submitted',
        approved: true,
      },
    })
    source.emitSessions({
      scope: 'sessions',
      sessionId: 'session-1',
      sequenceId: 3,
      version: 3,
      type: 'TitleChanged',
      occurredAt: 102,
      payload: { title: 'Next', titleSource: 'provider' },
    })
    source.emitSessions({
      scope: 'sessions',
      sessionId: 'session-1',
      sequenceId: 20,
      version: 5,
      type: 'SnapshotRequired',
      occurredAt: 103,
      payload: {
        reason: 'tail_gap',
        latestVersion: 5,
        latestSequenceId: 20,
      },
    })

    expect(onSessionChanged).toHaveBeenCalledTimes(3)
    expect(onSnapshotRequired).toHaveBeenCalledTimes(1)
    expect(engine.getLastSeenSequenceId()).toBe(20)

    engine.stop()
    expect(source.closed).toBe(true)
  })

  it('requests a snapshot refresh when the event tail reports an error', () => {
    const source = new FakeEventSource()
    const onSessionChanged = vi.fn()
    const onSnapshotRequired = vi.fn()
    const onError = vi.fn()
    const engine = new GlobalSessionSyncEngine({
      serverBaseUrl: 'http://127.0.0.1:21423',
      eventSourceFactory: () => source,
      callbacks: {
        onSessionChanged,
        onSnapshotRequired,
        onError,
      },
    })

    engine.start()
    source.emitError()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onSnapshotRequired).toHaveBeenCalledTimes(1)
    expect(onSessionChanged).not.toHaveBeenCalled()
  })
})
