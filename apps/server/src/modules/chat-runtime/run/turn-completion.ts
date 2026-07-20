import type { UIMessageChunk } from 'ai'

import type { ActiveRun } from '../run-registry'
import type { RuntimeGoalContinuationOptions } from '../runtime-provider-types'
import type { ChatRuntimeProfile } from './profile'
import type { PersistedTerminalChunk } from './terminal-finalizer'

export type ActiveTurnCompletionSource
  = | 'normal'
    | 'cancel'
    | 'provider-synthetic'
    | 'stale-fence'
    | 'shutdown'

export type ActiveTurnHandoff
  = | { kind: 'queue' }
    | {
      kind: 'runtime-goal'
      providerTargetId: string
      modelId?: string
      options: RuntimeGoalContinuationOptions
    }
    | { kind: 'none' }

export interface ActiveTurnOutcome {
  source: ActiveTurnCompletionSource
  terminalChunk: UIMessageChunk
  profile?: ChatRuntimeProfile
  /** Required work blocks notification and handoff when it rejects. */
  requiredBookkeeping?: (terminalChunk: UIMessageChunk) => Promise<void>
  /** Best-effort work is observed and logged, but cannot reopen a durable terminal. */
  bestEffortBookkeeping?: (terminalChunk: UIMessageChunk) => Promise<void> | void
  /** Resolved after bookkeeping; the completion owner performs it after release. */
  resolveHandoff?: () => ActiveTurnHandoff
}

export interface ActiveTurnCompletionResult {
  durableTerminal: boolean
  terminalChunk?: UIMessageChunk
}

export interface ActiveTurnCompletionDeps {
  persistTerminalChunk: (
    activeRun: ActiveRun,
    chunk: UIMessageChunk,
    profile?: ChatRuntimeProfile,
  ) => Promise<PersistedTerminalChunk>
  publishTerminalNotification: (activeRun: ActiveRun, chunk: UIMessageChunk) => void
  recoverTerminalPersistenceFailure: (activeRun: ActiveRun) => Promise<PersistedTerminalChunk | null>
  releaseActiveRun: (activeRun: ActiveRun) => void
  performHandoff: (activeRun: ActiveRun, handoff: ActiveTurnHandoff) => void
  recordTerminalPersistenceIncident: (input: {
    activeRun: ActiveRun
    source: ActiveTurnCompletionSource
    terminalError: unknown
    recoveryError: unknown
  }) => void
  warn: (message: string, payload: Record<string, unknown>) => void
}

export interface ActiveTurnCompletionController {
  completeActiveTurn: (
    activeRun: ActiveRun,
    outcome: ActiveTurnOutcome,
  ) => Promise<ActiveTurnCompletionResult>
}

export function createActiveTurnCompletionController(
  deps: ActiveTurnCompletionDeps,
): ActiveTurnCompletionController {
  const completionByRun = new WeakMap<ActiveRun, Promise<ActiveTurnCompletionResult>>()

  function completeActiveTurn(
    activeRun: ActiveRun,
    outcome: ActiveTurnOutcome,
  ): Promise<ActiveTurnCompletionResult> {
    const existing = completionByRun.get(activeRun)
    if (existing) {
      return existing
    }

    const completion = performCompletion(activeRun, outcome, deps)
    completionByRun.set(activeRun, completion)
    return completion
  }

  return { completeActiveTurn }
}

async function performCompletion(
  activeRun: ActiveRun,
  outcome: ActiveTurnOutcome,
  deps: ActiveTurnCompletionDeps,
): Promise<ActiveTurnCompletionResult> {
  let handoffAllowed = false
  try {
    let persistedTerminal: PersistedTerminalChunk
    try {
      persistedTerminal = await deps.persistTerminalChunk(
        activeRun,
        outcome.terminalChunk,
        outcome.profile,
      )
    }
    catch (terminalError) {
      let recoveredTerminal: PersistedTerminalChunk | null
      try {
        recoveredTerminal = await deps.recoverTerminalPersistenceFailure(activeRun)
      }
      catch (recoveryError) {
        deps.recordTerminalPersistenceIncident({
          activeRun,
          source: outcome.source,
          terminalError,
          recoveryError,
        })
        throw terminalError
      }
      if (!recoveredTerminal?.durableTerminal) {
        const recoveryError = new Error('Terminal persistence recovery did not establish a durable terminal state.')
        deps.recordTerminalPersistenceIncident({
          activeRun,
          source: outcome.source,
          terminalError,
          recoveryError,
        })
        throw terminalError
      }
      persistedTerminal = recoveredTerminal
    }

    if (!persistedTerminal.durableTerminal) {
      return { durableTerminal: false }
    }

    await outcome.requiredBookkeeping?.(persistedTerminal.notificationChunk)
    try {
      await outcome.bestEffortBookkeeping?.(persistedTerminal.notificationChunk)
    }
    catch (error) {
      deps.warn('best-effort chat turn completion bookkeeping failed', {
        error,
        source: outcome.source,
        sessionId: activeRun.sessionId,
        runId: activeRun.runId,
      })
    }

    deps.publishTerminalNotification(activeRun, persistedTerminal.notificationChunk)
    handoffAllowed = true
    return { durableTerminal: true, terminalChunk: persistedTerminal.notificationChunk }
  }
  finally {
    deps.releaseActiveRun(activeRun)
    if (handoffAllowed) {
      deps.performHandoff(activeRun, outcome.resolveHandoff?.() ?? { kind: 'queue' })
    }
  }
}
