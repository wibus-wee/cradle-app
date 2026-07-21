import { rejectPendingToolApprovalsForRun } from '../pending-tool-approval'
import { rejectPendingUserInputsForRun } from '../pending-user-input'
import type { ActiveRun } from '../run-registry'
import { runRegistry } from '../run-registry'
import { runSubscribers } from '../stream/live-run-streams'

export interface ActiveRunReleaseDeps {
  stopSnapshotTimer: (activeRun: ActiveRun) => void
  stopPendingRunDeltaFlush: (activeRun: ActiveRun) => void
}

export interface ActiveRunReleaseController {
  releaseActiveRun: (activeRun: ActiveRun) => void
}

export function createActiveRunReleaseController(
  deps: ActiveRunReleaseDeps,
): ActiveRunReleaseController {
  function releaseActiveRun(activeRun: ActiveRun): void {
    deps.stopSnapshotTimer(activeRun)
    deps.stopPendingRunDeltaFlush(activeRun)
    rejectPendingUserInputsForRun(
      activeRun.runId,
      new Error('Chat run ended before pending user input was submitted'),
    )
    rejectPendingToolApprovalsForRun(
      activeRun.runId,
      new Error('Chat run ended before pending tool approval was submitted'),
    )
    runRegistry.deleteActiveRun(activeRun.runId)
    runSubscribers.delete(activeRun.runId)
    if (runRegistry.getActiveRunIdForSession(activeRun.sessionId) === activeRun.runId) {
      runRegistry.deleteActiveRunIdForSession(activeRun.sessionId)
    }
    activeRun.pendingDeltaChunk = null
    activeRun.pendingStreamingSnapshotMessageJson = null
    activeRun.lastStreamingSnapshotMessageJson = null
    activeRun.runChunkLog.clear()
    activeRun.snapshotEventIdByCoalesceKey.clear()
    activeRun.finalMessage.parts = []
    activeRun.finalProjection.activeTextParts.clear()
    activeRun.finalProjection.activeReasoningParts.clear()
    activeRun.finalProjection.partialToolCalls.clear()
  }

  return {
    releaseActiveRun,
  }
}
