import type { BackendRun } from '@cradle/db'
import { backendRuns } from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { db } from '../../../infra'
import { cancelQueuedSessionItem, normalizeSessionQueuePositions } from '../es/commands'
import { abortProjectedStreamingRun, recoverChatRuntimeSession } from '../es/recovery'
import { attachBinding, getSessionRunContext } from '../runtime-session-context'
import { runRegistry, type ActiveRun, type TerminalChatMessageStatus } from '../run-registry'

export interface ActiveRunLifecycleDeps {
  readRun(runId: string): BackendRun | undefined
  settleActiveRun(
    activeRun: ActiveRun,
    status: TerminalChatMessageStatus,
    errorText: string | null
  ): Promise<void>
  releaseActiveRun(activeRun: ActiveRun): void
  warn(message: string, payload: Record<string, unknown>): void
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
        details: { runId }
      })
    }
    await abortProjectedStreamingRun(persistedRun)
    return
  }

  await deps.settleActiveRun(active, 'aborted', null)
  try {
    await requestRuntimeCancel(active, deps)
  } finally {
    deps.releaseActiveRun(active)
  }
}

export async function cancelSession(
  sessionId: string,
  deps: ActiveRunLifecycleDeps
): Promise<void> {
  if (await releaseTerminalPersistedActiveRunForSession(sessionId, deps)) {
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
      await deps.settleActiveRun(active, 'aborted', null)
      await requestRuntimeCancel(active, deps)
    } catch {
      /* best-effort */
    } finally {
      deps.releaseActiveRun(active)
    }
  }
  runRegistry.clearAll()
}

export async function releaseTerminalPersistedActiveRunForSession(
  sessionId: string,
  deps: Pick<ActiveRunLifecycleDeps, 'readRun' | 'releaseActiveRun'>
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
    activeRun.terminalStatus ??= run.status
    deps.releaseActiveRun(activeRun)
  } else {
    runRegistry.deleteActiveRunIdForSession(sessionId)
  }
  return true
}

export async function finalizeInterruptedPersistedStreamingSessionIfIdle(
  sessionId: string,
  deps: Pick<ActiveRunLifecycleDeps, 'readRun' | 'releaseActiveRun'>
): Promise<void> {
  await releaseTerminalPersistedActiveRunForSession(sessionId, deps)
  if (!runRegistry.hasActiveRunForSession(sessionId) && !runRegistry.hasPendingRun(sessionId)) {
    await recoverChatRuntimeSession(sessionId)
  }
}

async function requestRuntimeCancel(
  activeRun: ActiveRun,
  deps: Pick<ActiveRunLifecycleDeps, 'warn'>
): Promise<void> {
  const context = getSessionRunContext(activeRun.sessionId)
  if (!context) {
    deps.warn('cannot cancel runtime turn because chat session context is missing', {
      sessionId: activeRun.sessionId,
      runId: activeRun.runId
    })
    return
  }

  try {
    await activeRun.runtime.cancelTurn({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile
    })
  } catch (error) {
    deps.warn('runtime turn cancellation failed after chat run was marked aborted', {
      error,
      sessionId: activeRun.sessionId,
      runId: activeRun.runId
    })
  } finally {
    try {
      attachBinding({
        sessionId: activeRun.sessionId,
        providerTargetId: activeRun.providerTargetId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        runtimeSession: activeRun.runtimeSession,
        requestedModelId: activeRun.modelId
      })
    } catch (error) {
      deps.warn('failed to persist runtime session after cancellation', {
        error,
        sessionId: activeRun.sessionId,
        runId: activeRun.runId
      })
    }
  }
}
