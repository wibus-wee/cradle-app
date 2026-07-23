import type { BackendRun } from '@cradle/db'
import { backendRuns } from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { db } from '../../../infra'
import { cancelQueuedSessionItem, normalizeSessionQueuePositions } from '../es/commands'
import { abortProjectedStreamingRun } from '../es/recovery'
import type { ActiveTurnCompletionController } from '../run/turn-completion'
import type { ActiveRun } from '../run-registry'
import { runRegistry } from '../run-registry'
import { attachBinding, getSessionRunContext } from '../runtime-session-context'

export interface ActiveRunLifecycleDeps {
  readRun: (runId: string) => BackendRun | undefined
  completeActiveTurn: ActiveTurnCompletionController['completeActiveTurn']
  warn: (message: string, payload: Record<string, unknown>) => void
}

export async function abortRun(runId: string, deps: ActiveRunLifecycleDeps): Promise<void> {
  const active = runRegistry.getActiveRun(runId)
  if (!active) {
    const persistedRun = deps.readRun(runId)
    if (!persistedRun) {
      throw new AppError({
        code: 'chat_run_not_found',
        status: 404,
        message: 'Chat run not found',
        details: { runId },
      })
    }
    await abortProjectedStreamingRun(persistedRun)
    return
  }

  active.cancelRequested = true
  await requestRuntimeCancel(active, deps)
}

export async function cancelSession(
  sessionId: string,
  deps: ActiveRunLifecycleDeps,
): Promise<void> {
  if (await completeTerminalPersistedActiveRunForSession(sessionId, deps)) {
    return
  }
  const runId = runRegistry.getActiveRunIdForSession(sessionId)
  if (!runId) {
    const pendingState = runRegistry.getPendingRun(sessionId)
    if (pendingState) {
      pendingState.cancelled = true
      if (pendingState.queueItemId) {
        await cancelQueuedSessionItem(sessionId, pendingState.queueItemId)
        await normalizeSessionQueuePositions(sessionId)
      }
      return
    }
    const streamingRuns = db()
      .select()
      .from(backendRuns)
      .where(and(eq(backendRuns.chatSessionId, sessionId), eq(backendRuns.status, 'streaming')))
      .all()
    for (const run of streamingRuns) {
      await abortProjectedStreamingRun(run)
    }
    return
  }
  await abortRun(runId, deps)
}

export async function abortAllRuns(deps: ActiveRunLifecycleDeps): Promise<void> {
  const runIds = runRegistry.listActiveRunIds()
  for (const runId of runIds) {
    const active = runRegistry.getActiveRun(runId)
    if (!active) {
      continue
    }
    try {
      active.cancelRequested = true
      await deps.completeActiveTurn(active, {
        source: 'shutdown',
        terminalChunk: { type: 'abort', reason: 'user' },
        bestEffortBookkeeping: () => requestRuntimeCancel(active, deps),
        resolveHandoff: () => ({ kind: 'none' }),
      })
    }
 catch {
      /* best-effort */
    }
  }
  runRegistry.clearAll()
}

export async function completeTerminalPersistedActiveRunForSession(
  sessionId: string,
  deps: Pick<ActiveRunLifecycleDeps, 'readRun' | 'completeActiveTurn'>,
): Promise<boolean> {
  const runId = runRegistry.getActiveRunIdForSession(sessionId)
  if (!runId) {
    return false
  }

  const run = deps.readRun(runId)
  if (!run) {
    return false
  }
  if (run.status === 'streaming') {
    return false
  }

  const activeRun = runRegistry.getActiveRun(runId)
  if (activeRun) {
    await deps.completeActiveTurn(activeRun, {
      source: 'stale-fence',
      terminalChunk:
        run.status === 'complete'
          ? { type: 'finish', finishReason: 'stop' }
          : run.status === 'aborted'
            ? { type: 'abort', reason: 'user' }
            : { type: 'error', errorText: run.errorText ?? 'Chat run failed' },
    })
  }
 else {
    runRegistry.deleteActiveRunIdForSession(sessionId)
  }
  return true
}

async function requestRuntimeCancel(
  activeRun: ActiveRun,
  deps: Pick<ActiveRunLifecycleDeps, 'warn'>,
): Promise<void> {
  const context = getSessionRunContext(activeRun.sessionId)
  if (!context) {
    deps.warn('cannot cancel runtime turn because chat session context is missing', {
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
    })
    return
  }

  try {
    await activeRun.runtime.cancelTurn({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile,
    })
  }
  catch (error) {
    deps.warn('runtime turn cancellation failed before native turn settlement', {
      error,
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
    })
    throw error
  }
 finally {
    try {
      attachBinding({
        sessionId: activeRun.sessionId,
        providerTargetId: activeRun.providerTargetId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        runtimeSession: activeRun.runtimeSession,
        requestedModelId: activeRun.modelId,
      })
    }
 catch (error) {
      deps.warn('failed to persist runtime session after cancellation', {
        error,
        sessionId: activeRun.sessionId,
        runId: activeRun.runId,
      })
    }
  }
}
