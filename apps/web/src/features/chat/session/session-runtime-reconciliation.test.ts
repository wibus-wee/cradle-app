import { describe, expect, it } from 'vitest'

import type {
  RuntimeSessionRunStatus,
  RuntimeSessionStatus,
} from '../commands/runtime-session-status-command'
import {
  deriveRuntimeActiveRunRefresh,
  deriveRuntimeQueueRefresh,
  deriveRuntimeTerminalRunRefresh,
  readTerminalRunReleaseCandidate,
} from './session-runtime-reconciliation'

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
    status: input.status ?? (input.activeRun ? 'running' : 'idle'),
    activeRun: input.activeRun ?? null,
    latestRun: input.latestRun ?? input.activeRun ?? null,
    queue: {
      pending: input.pending ?? 0,
      running: input.running ?? (input.activeRun ? 1 : 0),
    },
    pendingQueueItemId: input.pendingQueueItemId ?? null,
  } as RuntimeSessionStatus
}

describe('session runtime reconciliation', () => {
  it('requests a snapshot once when an active run message is missing locally', () => {
    expect(deriveRuntimeActiveRunRefresh({
      activeRunMessageId: 'assistant-live',
      snapshotMessageIds: new Set(['assistant-old']),
      storeMessageIds: new Set(['assistant-old']),
      previousRequestedMessageId: null,
    })).toEqual({
      requestSnapshotRefresh: true,
      nextRequestedMessageId: 'assistant-live',
    })

    expect(deriveRuntimeActiveRunRefresh({
      activeRunMessageId: 'assistant-live',
      snapshotMessageIds: new Set(['assistant-old']),
      storeMessageIds: new Set(['assistant-old']),
      previousRequestedMessageId: 'assistant-live',
    })).toEqual({
      requestSnapshotRefresh: false,
      nextRequestedMessageId: 'assistant-live',
    })
  })

  it('clears the active-run snapshot request once the message appears', () => {
    expect(deriveRuntimeActiveRunRefresh({
      activeRunMessageId: 'assistant-live',
      snapshotMessageIds: new Set(['assistant-live']),
      storeMessageIds: new Set(),
      previousRequestedMessageId: 'assistant-live',
    })).toEqual({
      requestSnapshotRefresh: false,
      nextRequestedMessageId: null,
    })
  })

  it('requests a snapshot once for a terminal latest run missing from both snapshot and store', () => {
    const status = runtimeStatus({
      latestRun: runtimeRun({
        runId: 'run-complete',
        messageId: 'assistant-complete',
        status: 'complete',
      }),
    })

    expect(deriveRuntimeTerminalRunRefresh({
      runtimeStatus: status,
      snapshotMessageIds: new Set(),
      storeMessageIds: new Set(),
      previousRefreshRunId: null,
    })).toEqual({
      requestSnapshotRefresh: true,
      nextRefreshRunId: 'run-complete',
    })

    expect(deriveRuntimeTerminalRunRefresh({
      runtimeStatus: status,
      snapshotMessageIds: new Set(),
      storeMessageIds: new Set(),
      previousRefreshRunId: 'run-complete',
    })).toEqual({
      requestSnapshotRefresh: false,
      nextRefreshRunId: 'run-complete',
    })
  })

  it('does not request terminal-run snapshots while another run is active', () => {
    const activeRun = runtimeRun({
      runId: 'run-active',
      messageId: 'assistant-active',
      status: 'streaming',
    })
    const latestRun = runtimeRun({
      runId: 'run-complete',
      messageId: 'assistant-complete',
      status: 'complete',
    })

    expect(deriveRuntimeTerminalRunRefresh({
      runtimeStatus: runtimeStatus({ activeRun, latestRun }),
      snapshotMessageIds: new Set(),
      storeMessageIds: new Set(),
      previousRefreshRunId: null,
    })).toEqual({
      requestSnapshotRefresh: false,
      nextRefreshRunId: null,
    })
    expect(readTerminalRunReleaseCandidate(runtimeStatus({ activeRun, latestRun }))).toBeNull()
  })

  it('requests queue refresh only when the queue signature changes into active work', () => {
    const idle = runtimeStatus({})
    const first = deriveRuntimeQueueRefresh({
      runtimeStatus: idle,
      previousSignature: null,
    })
    expect(first).toEqual({
      requestQueueRefresh: false,
      nextSignature: '0:0::',
    })

    const pending = runtimeStatus({ pending: 1, pendingQueueItemId: 'queue-1' })
    const second = deriveRuntimeQueueRefresh({
      runtimeStatus: pending,
      previousSignature: first.nextSignature,
    })
    expect(second).toEqual({
      requestQueueRefresh: true,
      nextSignature: '1:0:queue-1:',
    })

    expect(deriveRuntimeQueueRefresh({
      runtimeStatus: pending,
      previousSignature: second.nextSignature,
    })).toEqual({
      requestQueueRefresh: false,
      nextSignature: '1:0:queue-1:',
    })
  })
})
