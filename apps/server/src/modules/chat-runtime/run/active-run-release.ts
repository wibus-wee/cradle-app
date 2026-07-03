import type { UIMessageChunk } from 'ai'

import { rejectPendingToolApprovalsForRun } from '../pending-tool-approval'
import { rejectPendingUserInputsForRun } from '../pending-user-input'
import { runSubscribers } from '../stream/live-run-streams'
import { runRegistry, type ActiveRun } from '../run-registry'
import type { RunWriteFence } from './run-write-fence'
import { terminalChunkForFence } from './terminal-finalizer'

export interface ActiveRunReleaseDeps {
  stopSnapshotTimer(activeRun: ActiveRun): void
  stopPendingRunDeltaFlush(activeRun: ActiveRun): void
  publishUIMessageChunk(activeRun: ActiveRun, chunk: UIMessageChunk, terminal: boolean): void
}

export interface ActiveRunReleaseController {
  releaseActiveRun(activeRun: ActiveRun): void
  releaseStaleActiveRun(activeRun: ActiveRun, fence: RunWriteFence): void
}

export function createActiveRunReleaseController(
  deps: ActiveRunReleaseDeps
): ActiveRunReleaseController {
  function releaseStaleActiveRun(activeRun: ActiveRun, fence: RunWriteFence): void {
    if (fence.status !== 'streaming' && fence.status !== 'missing') {
      activeRun.terminalStatus ??= fence.status
    }
    deps.publishUIMessageChunk(activeRun, terminalChunkForFence(fence), true)
    releaseActiveRun(activeRun)
  }

  function releaseActiveRun(activeRun: ActiveRun): void {
    deps.stopSnapshotTimer(activeRun)
    deps.stopPendingRunDeltaFlush(activeRun)
    rejectPendingUserInputsForRun(
      activeRun.runId,
      new Error('Chat run ended before pending user input was submitted')
    )
    rejectPendingToolApprovalsForRun(
      activeRun.runId,
      new Error('Chat run ended before pending tool approval was submitted')
    )
    runRegistry.deleteActiveRun(activeRun.runId)
    runSubscribers.delete(activeRun.runId)
    if (runRegistry.getActiveRunIdForSession(activeRun.sessionId) === activeRun.runId) {
      runRegistry.deleteActiveRunIdForSession(activeRun.sessionId)
    }
    activeRun.pendingDeltaChunk = null
    activeRun.chunkBuffer = []
    activeRun.chunkBufferIndexByKey.clear()
    activeRun.finalMessage.parts = []
    activeRun.finalProjection.activeTextParts.clear()
    activeRun.finalProjection.activeReasoningParts.clear()
    activeRun.finalProjection.partialToolCalls.clear()
  }

  return {
    releaseActiveRun,
    releaseStaleActiveRun
  }
}
