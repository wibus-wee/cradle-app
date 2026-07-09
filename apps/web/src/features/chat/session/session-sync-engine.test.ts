import { describe, expect, it, vi } from 'vitest'

import type {
  RuntimeSessionRunStatus,
  RuntimeSessionStatus,
} from '../commands/runtime-session-status-command'
import type { SessionEventSource } from './session-sync-engine'
import {
  buildSessionEventTailUrl,
  SessionSyncEngine,
} from './session-sync-engine'

class FakeEventSource implements SessionEventSource {
  readonly listeners = new Map<string, Array<(event: MessageEvent<string> | Event) => void>>()
  closed = false

  addEventListener(type: 'session', listener: (event: MessageEvent<string>) => void): void
  addEventListener(type: 'error', listener: (event: Event) => void): void
  addEventListener(type: 'session' | 'error', listener: ((event: MessageEvent<string>) => void) | ((event: Event) => void)): void {
    const current = this.listeners.get(type) ?? []
    current.push(listener as (event: MessageEvent<string> | Event) => void)
    this.listeners.set(type, current)
  }

  close(): void {
    this.closed = true
  }

  emitSession(data: unknown): void {
    for (const listener of this.listeners.get('session') ?? []) {
      listener(new MessageEvent('session', { data: JSON.stringify(data) }))
    }
  }

  emitError(): void {
    for (const listener of this.listeners.get('error') ?? []) {
      listener(new Event('error'))
    }
  }
}

function createCallbacks() {
  return {
    onMessagesChanged: vi.fn(),
    onRuntimeStatusChanged: vi.fn(),
    onRuntimeUiSlotStatesChanged: vi.fn(),
    onQueueChanged: vi.fn(),
    onSessionSummaryChanged: vi.fn(),
    onSnapshotRequired: vi.fn(),
    onError: vi.fn(),
  }
}

function runtimeRun(
  input: Pick<RuntimeSessionRunStatus, 'runId' | 'messageId' | 'status'> & {
    queueItemId?: string | null
  },
): RuntimeSessionRunStatus {
  return {
    runId: input.runId,
    messageId: input.messageId,
    status: input.status,
    queueItemId: input.queueItemId ?? null,
    startedAt: 0,
    finishedAt: null,
    modelId: null,
    providerSessionId: null,
    runtimeSettings: {
      accessMode: 'approval-required',
      interactionMode: 'default',
    },
  }
}

function runtimeStatus(input: {
  status?: RuntimeSessionStatus['status']
  activeRun?: RuntimeSessionRunStatus | null
  latestRun?: RuntimeSessionRunStatus | null
  pending?: number
  running?: number
  pendingQueueItemId?: string | null
}): RuntimeSessionStatus {
  return {
    sessionId: 'session-1',
    status: input.status ?? (input.activeRun ? 'streaming' : 'idle'),
    runtimeKind: 'codex',
    providerTargetId: null,
    providerSessionId: null,
    modelId: null,
    runtimeSettings: {
      accessMode: 'approval-required',
      interactionMode: 'default',
    },
    pendingQueueItemId: input.pendingQueueItemId ?? null,
    hasActiveGoal: false,
    supportsLastTurnRollback: true,
    activeRun: input.activeRun ?? null,
    latestRun: input.latestRun ?? input.activeRun ?? null,
    queue: {
      pending: input.pending ?? 0,
      running: input.running ?? (input.activeRun ? 1 : 0),
    },
  }
}

describe('sessionSyncEngine', () => {
  it('builds a session event tail URL with afterVersion', () => {
    expect(buildSessionEventTailUrl({
      serverBaseUrl: 'http://127.0.0.1:21423',
      sessionId: 'session/1',
      afterVersion: 4,
    })).toBe('http://127.0.0.1:21423/chat/sessions/session%2F1/events?afterVersion=4')
  })

  it('maps slim session events to directed invalidations and ignores duplicate versions', () => {
    const source = new FakeEventSource()
    const callbacks = createCallbacks()
    const engine = new SessionSyncEngine({
      sessionId: 'session-1',
      serverBaseUrl: 'http://127.0.0.1:21423',
      eventSourceFactory: () => source,
      callbacks,
    })

    engine.start()
    source.emitSession({
      scope: 'session',
      sessionId: 'session-1',
      sequenceId: 1,
      version: 1,
      type: 'RunStarted',
      occurredAt: 100,
      payload: { runId: 'run-1', assistantMessageId: 'assistant-1', queueItemId: null },
    })
    source.emitSession({
      scope: 'session',
      sessionId: 'session-1',
      sequenceId: 1,
      version: 1,
      type: 'RunStarted',
      occurredAt: 100,
      payload: { runId: 'run-1', assistantMessageId: 'assistant-1', queueItemId: null },
    })
    source.emitSession({
      scope: 'session',
      sessionId: 'session-1',
      sequenceId: 2,
      version: 2,
      type: 'InteractionRequested',
      occurredAt: 101,
      payload: {
        runId: 'run-1',
        requestId: 'approval-1',
        interactionKind: 'toolApproval',
        providerMethod: 'applyPatchApproval',
        toolCallId: 'tool-1',
        questionCount: null,
      },
    })
    source.emitSession({
      scope: 'session',
      sessionId: 'session-1',
      sequenceId: 3,
      version: 3,
      type: 'QueueItemEnqueued',
      occurredAt: 102,
      payload: { queueItemId: 'queue-1', status: 'pending' },
    })
    source.emitSession({
      scope: 'session',
      sessionId: 'session-1',
      sequenceId: 4,
      version: 4,
      type: 'AssistantMessageCompleted',
      occurredAt: 103,
      payload: { messageId: 'assistant-1', status: 'complete' },
    })
    source.emitSession({
      scope: 'session',
      sessionId: 'session-1',
      sequenceId: 20,
      version: 20,
      type: 'SnapshotRequired',
      occurredAt: 110,
      payload: {
        reason: 'tail_gap',
        latestVersion: 20,
        latestSequenceId: 20,
      },
    })

    expect(callbacks.onRuntimeStatusChanged).toHaveBeenCalledTimes(4)
    expect(callbacks.onRuntimeUiSlotStatesChanged).toHaveBeenCalledTimes(4)
    expect(callbacks.onQueueChanged).toHaveBeenCalledTimes(2)
    expect(callbacks.onMessagesChanged).toHaveBeenCalledTimes(2)
    expect(callbacks.onSessionSummaryChanged).toHaveBeenCalledTimes(1)
    expect(callbacks.onSnapshotRequired).toHaveBeenCalledTimes(1)
    expect(engine.getLastSeenVersion()).toBe(20)

    engine.stop()
    expect(source.closed).toBe(true)
  })

  it('requests catch-up when the event tail reports an error', () => {
    const source = new FakeEventSource()
    const callbacks = createCallbacks()
    const engine = new SessionSyncEngine({
      sessionId: 'session-1',
      serverBaseUrl: 'http://127.0.0.1:21423',
      eventSourceFactory: () => source,
      callbacks,
    })

    engine.start()
    source.emitError()

    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onMessagesChanged).toHaveBeenCalledTimes(1)
    expect(callbacks.onRuntimeStatusChanged).toHaveBeenCalledTimes(1)
    expect(callbacks.onRuntimeUiSlotStatesChanged).toHaveBeenCalledTimes(1)
    expect(callbacks.onQueueChanged).toHaveBeenCalledTimes(1)
    expect(callbacks.onSessionSummaryChanged).toHaveBeenCalledTimes(1)
  })

  it('requests a snapshot refresh for completed assistant messages', () => {
    const source = new FakeEventSource()
    const callbacks = createCallbacks()
    const engine = new SessionSyncEngine({
      sessionId: 'session-1',
      serverBaseUrl: 'http://127.0.0.1:21423',
      eventSourceFactory: () => source,
      callbacks,
    })

    engine.start()
    source.emitSession({
      scope: 'session',
      sessionId: 'session-1',
      sequenceId: 1,
      version: 1,
      type: 'AssistantMessageCompleted',
      occurredAt: 100,
      payload: {
        messageId: 'assistant-1',
        status: 'complete',
      },
    })

    expect(callbacks.onMessagesChanged).toHaveBeenCalledTimes(1)
    expect(callbacks.onRuntimeUiSlotStatesChanged).toHaveBeenCalledTimes(1)
  })

  it('starts, replaces, and stops passive chunk streams from runtime state inputs', () => {
    const source = new FakeEventSource()
    const callbacks = createCallbacks()
    const closed: string[] = []
    const settled: Array<() => void> = []
    const starts: string[] = []
    const engine = new SessionSyncEngine({
      sessionId: 'session-1',
      serverBaseUrl: 'http://127.0.0.1:21423',
      eventSourceFactory: () => source,
      passiveStreamFactory: (request) => {
        starts.push(`${request.sessionId}:${request.messageId}`)
        settled.push(request.onSettled)
        return {
          close: () => {
            closed.push(`${request.sessionId}:${request.messageId}`)
          },
        }
      },
      callbacks,
    })

    engine.updatePassiveStream({
      enabled: true,
      sessionId: 'session-1',
      locallyDriven: false,
      runtimeActiveRunMessageId: 'assistant-1',
    })
    engine.updatePassiveStream({
      enabled: true,
      sessionId: 'session-1',
      locallyDriven: false,
      runtimeActiveRunMessageId: 'assistant-1',
    })
    engine.updatePassiveStream({
      enabled: true,
      sessionId: 'session-1',
      locallyDriven: false,
      runtimeActiveRunMessageId: 'assistant-2',
    })
    engine.updatePassiveStream({
      enabled: true,
      sessionId: 'session-1',
      locallyDriven: true,
      runtimeActiveRunMessageId: 'assistant-2',
    })

    expect(starts).toEqual(['session-1:assistant-1', 'session-1:assistant-2'])
    expect(closed).toEqual(['session-1:assistant-1', 'session-1:assistant-2'])

    settled[1]?.()
    engine.updatePassiveStream({
      enabled: true,
      sessionId: 'session-1',
      locallyDriven: false,
      runtimeActiveRunMessageId: null,
    })

    expect(starts).toEqual(['session-1:assistant-1', 'session-1:assistant-2'])
    engine.stop()
    expect(closed).toEqual(['session-1:assistant-1', 'session-1:assistant-2'])
  })

  it('does not close or reopen a passive stream during snapshot fetch jitter', () => {
    const callbacks = createCallbacks()
    const closed: string[] = []
    const starts: string[] = []
    const engine = new SessionSyncEngine({
      sessionId: 'session-1',
      serverBaseUrl: 'http://127.0.0.1:21423',
      passiveStreamFactory: (request) => {
        starts.push(`${request.sessionId}:${request.messageId}`)
        return {
          close: () => {
            closed.push(`${request.sessionId}:${request.messageId}`)
          },
        }
      },
      callbacks,
    })

    for (let i = 0; i < 3; i++) {
      engine.updatePassiveStream({
        enabled: true,
        sessionId: 'session-1',
        locallyDriven: false,
        runtimeActiveRunMessageId: 'assistant-1',
      })
    }

    expect(starts).toEqual(['session-1:assistant-1'])
    expect(closed).toEqual([])
  })

  it('deduplicates runtime reconciliation decisions inside the engine', () => {
    const engine = new SessionSyncEngine({
      sessionId: 'session-1',
      serverBaseUrl: 'http://127.0.0.1:21423',
      callbacks: createCallbacks(),
    })
    const activeRun = runtimeRun({
      runId: 'run-active',
      messageId: 'assistant-active',
      status: 'streaming',
      queueItemId: 'queue-active',
    })
    const activeStatus = runtimeStatus({ activeRun })

    expect(engine.reconcileRuntimeState({
      runtimeStatus: activeStatus,
      activeRun,
      snapshotMessageIds: new Set(),
      storeMessageIds: new Set(),
    })).toMatchObject({
      runDisplay: {
        messageId: 'assistant-active',
        runId: 'run-active',
      },
      requestSnapshotRefresh: true,
      requestQueueRefresh: true,
      terminalRunReleaseCandidate: null,
    })

    expect(engine.reconcileRuntimeState({
      runtimeStatus: activeStatus,
      activeRun,
      snapshotMessageIds: new Set(),
      storeMessageIds: new Set(),
    })).toMatchObject({
      requestSnapshotRefresh: false,
      requestQueueRefresh: false,
    })

    const completeRun = runtimeRun({
      runId: 'run-complete',
      messageId: 'assistant-complete',
      status: 'complete',
    })
    const completeStatus = runtimeStatus({ latestRun: completeRun })

    expect(engine.reconcileRuntimeState({
      runtimeStatus: completeStatus,
      activeRun: null,
      snapshotMessageIds: new Set(),
      storeMessageIds: new Set(),
    })).toMatchObject({
      runDisplay: null,
      requestSnapshotRefresh: true,
      requestQueueRefresh: false,
      terminalRunReleaseCandidate: completeRun,
    })

    expect(engine.reconcileRuntimeState({
      runtimeStatus: completeStatus,
      activeRun: null,
      snapshotMessageIds: new Set(),
      storeMessageIds: new Set(),
    })).toMatchObject({
      requestSnapshotRefresh: false,
      requestQueueRefresh: false,
      terminalRunReleaseCandidate: null,
    })
  })
})
