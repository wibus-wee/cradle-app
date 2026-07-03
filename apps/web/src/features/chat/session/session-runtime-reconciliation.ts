import type {
  RuntimeSessionRunStatus,
  RuntimeSessionStatus,
} from '../commands/runtime-session-status-command'

export interface RuntimeActiveRunRefreshInput {
  activeRunMessageId: string | null
  snapshotMessageIds: ReadonlySet<string>
  storeMessageIds: ReadonlySet<string>
  previousRequestedMessageId: string | null
}

export interface RuntimeActiveRunRefreshDecision {
  requestSnapshotRefresh: boolean
  nextRequestedMessageId: string | null
}

export interface RuntimeTerminalRunRefreshInput {
  runtimeStatus: RuntimeSessionStatus | null | undefined
  snapshotMessageIds: ReadonlySet<string>
  storeMessageIds: ReadonlySet<string>
  previousRefreshRunId: string | null
}

export interface RuntimeTerminalRunRefreshDecision {
  requestSnapshotRefresh: boolean
  nextRefreshRunId: string | null
}

export interface RuntimeQueueRefreshInput {
  runtimeStatus: RuntimeSessionStatus | null | undefined
  previousSignature: string | null
}

export interface RuntimeQueueRefreshDecision {
  requestQueueRefresh: boolean
  nextSignature: string | null
}

export function deriveRuntimeActiveRunRefresh(
  input: RuntimeActiveRunRefreshInput,
): RuntimeActiveRunRefreshDecision {
  const activeRunMessageId = input.activeRunMessageId
  if (!activeRunMessageId) {
    return {
      requestSnapshotRefresh: false,
      nextRequestedMessageId: null,
    }
  }
  if (
    input.snapshotMessageIds.has(activeRunMessageId)
    || input.storeMessageIds.has(activeRunMessageId)
  ) {
    return {
      requestSnapshotRefresh: false,
      nextRequestedMessageId: null,
    }
  }
  if (input.previousRequestedMessageId === activeRunMessageId) {
    return {
      requestSnapshotRefresh: false,
      nextRequestedMessageId: activeRunMessageId,
    }
  }
  return {
    requestSnapshotRefresh: true,
    nextRequestedMessageId: activeRunMessageId,
  }
}

export function deriveRuntimeTerminalRunRefresh(
  input: RuntimeTerminalRunRefreshInput,
): RuntimeTerminalRunRefreshDecision {
  if (!input.runtimeStatus || input.runtimeStatus.activeRun) {
    return {
      requestSnapshotRefresh: false,
      nextRefreshRunId: input.previousRefreshRunId,
    }
  }

  const latestRun = input.runtimeStatus.latestRun
  if (
    !latestRun?.runId
    || !latestRun.messageId
    || !isTerminalChatRunStatus(latestRun.status)
    || input.snapshotMessageIds.has(latestRun.messageId)
    || input.storeMessageIds.has(latestRun.messageId)
  ) {
    return {
      requestSnapshotRefresh: false,
      nextRefreshRunId: input.previousRefreshRunId,
    }
  }
  if (input.previousRefreshRunId === latestRun.runId) {
    return {
      requestSnapshotRefresh: false,
      nextRefreshRunId: latestRun.runId,
    }
  }
  return {
    requestSnapshotRefresh: true,
    nextRefreshRunId: latestRun.runId,
  }
}

export function readTerminalRunReleaseCandidate(
  runtimeStatus: RuntimeSessionStatus | null | undefined,
): RuntimeSessionRunStatus | null {
  if (!runtimeStatus || runtimeStatus.activeRun) {
    return null
  }
  return runtimeStatus.latestRun ?? null
}

export function deriveRuntimeQueueRefresh(
  input: RuntimeQueueRefreshInput,
): RuntimeQueueRefreshDecision {
  if (!input.runtimeStatus) {
    return {
      requestQueueRefresh: false,
      nextSignature: null,
    }
  }

  const nextSignature = readRuntimeQueueSignature(input.runtimeStatus)
  if (input.previousSignature === nextSignature) {
    return {
      requestQueueRefresh: false,
      nextSignature,
    }
  }
  return {
    requestQueueRefresh: hasRuntimeQueueActivity(input.runtimeStatus),
    nextSignature,
  }
}

function readRuntimeQueueSignature(runtimeStatus: RuntimeSessionStatus): string {
  return [
    runtimeStatus.queue.pending,
    runtimeStatus.queue.running,
    runtimeStatus.pendingQueueItemId ?? '',
    runtimeStatus.activeRun?.queueItemId ?? '',
  ].join(':')
}

function hasRuntimeQueueActivity(runtimeStatus: RuntimeSessionStatus): boolean {
  return Boolean(
    runtimeStatus.queue.pending > 0
    || runtimeStatus.queue.running > 0
    || runtimeStatus.pendingQueueItemId
    || runtimeStatus.activeRun?.queueItemId,
  )
}

function isTerminalChatRunStatus(status: RuntimeSessionRunStatus['status']): boolean {
  return status === 'complete' || status === 'failed' || status === 'aborted'
}
