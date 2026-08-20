export type WorkDeliveryState
  = | 'draft'
    | 'queued'
    | 'preparing'
    | 'running'
    | 'awaiting_human'
    | 'awaiting_dependency'
    | 'verifying'
    | 'ready_for_review'
    | 'merging'
    | 'done'
    | 'failed'
    | 'cancelled'
    | 'archived'
    | 'unknown'

export type WorkStateAuthority
  = | 'official_hook'
    | 'runtime_integration'
    | 'terminal_recognizer'
    | 'user_override'
    | 'derived'

export type WorkStateResponsible = 'user' | 'agent' | 'dependency' | 'system'

export interface WorkStateExplanation {
  trigger: string
  evidence: string
  authority: WorkStateAuthority
  responsible: WorkStateResponsible
  nextAction: string
  observedAt: number
}

export type WorkRecoveryLevel = 'live' | 'resumable' | 'restorable' | 'reproducible' | 'unknown'

export interface WorkRecovery {
  level: WorkRecoveryLevel
  evidence: string
  lastHeartbeatAt: number | null
}

export interface WorkProjection {
  state: WorkDeliveryState
  stateSinceAt: number
  explanation: WorkStateExplanation
  recovery: WorkRecovery
}

export interface WorkProjectionFacts {
  observedAt: number
  workUpdatedAt: number
  sessionUpdatedAt: number
  archivedAt: number | null
  sessionArchivedAt: number | null
  sessionStatus: 'idle' | 'streaming' | 'error'
  worktreeHealth: 'ok' | 'missing' | 'stale' | null
  isIsolated: boolean
  hasPersistedSession: boolean
  hasDurableProviderBinding: boolean
  hasActiveRun: boolean
  pendingHumanInteraction: boolean
  pendingHumanSinceAt: number | null
  pendingHumanEvidence: string | null
  pendingDependency: boolean
  pendingDependencySinceAt: number | null
  pendingDependencyEvidence: string | null
  preparedAt: number | null
  lastSubmittedAt: number | null
  pullRequest: {
    isDraft: boolean
    state: 'open' | 'closed'
    merged: boolean
    updatedAt: number
  } | null
}

interface StateSelection {
  state: WorkDeliveryState
  stateSinceAt: number
  trigger: string
  evidence: string
  authority: WorkStateAuthority
  responsible: WorkStateResponsible
  nextAction: string
}

function selectState(facts: WorkProjectionFacts): StateSelection {
  if (facts.archivedAt !== null || facts.sessionArchivedAt !== null) {
    return {
      state: 'archived',
      stateSinceAt: facts.archivedAt ?? facts.sessionArchivedAt ?? facts.workUpdatedAt,
      trigger: 'work.archived',
      evidence: 'The user archived this Work and its primary Session.',
      authority: 'user_override',
      responsible: 'user',
      nextAction: 'Restore the Work only if delivery must continue.',
    }
  }

  if (facts.pullRequest?.merged) {
    return {
      state: 'done',
      stateSinceAt: facts.pullRequest.updatedAt,
      trigger: 'pull_request.merged',
      evidence: 'The bound pull request is reported as merged by GitHub.',
      authority: 'official_hook',
      responsible: 'user',
      nextAction: 'Archive the Work after confirming no follow-up is needed.',
    }
  }

  if (facts.pullRequest?.state === 'closed') {
    return {
      state: 'cancelled',
      stateSinceAt: facts.pullRequest.updatedAt,
      trigger: 'pull_request.closed',
      evidence: 'The bound pull request was closed without being merged.',
      authority: 'official_hook',
      responsible: 'user',
      nextAction: 'Reopen the pull request or archive the Work.',
    }
  }

  if (facts.sessionStatus === 'error') {
    return {
      state: 'failed',
      stateSinceAt: facts.sessionUpdatedAt,
      trigger: 'session.error',
      evidence: 'The primary Agent Run ended in an error state.',
      authority: 'runtime_integration',
      responsible: 'user',
      nextAction: 'Open the Work, inspect the failed run, and retry or cancel it.',
    }
  }

  if (!facts.isIsolated || facts.worktreeHealth !== 'ok') {
    return {
      state: 'failed',
      stateSinceAt: facts.sessionUpdatedAt,
      trigger: 'worktree.unhealthy',
      evidence: facts.isIsolated
        ? `The managed worktree health is ${facts.worktreeHealth ?? 'unknown'}.`
        : 'The primary Session no longer has an isolated managed worktree.',
      authority: 'official_hook',
      responsible: 'user',
      nextAction: 'Redetect the checkout, then repair or recreate the Work isolation boundary.',
    }
  }

  if (facts.pendingHumanInteraction) {
    return {
      state: 'awaiting_human',
      stateSinceAt: facts.pendingHumanSinceAt ?? facts.sessionUpdatedAt,
      trigger: 'interaction.pending',
      evidence: facts.pendingHumanEvidence ?? 'The Agent Run is waiting for a user response.',
      authority: 'runtime_integration',
      responsible: 'user',
      nextAction: 'Open the Work and answer or approve the pending request.',
    }
  }

  if (facts.pendingDependency) {
    return {
      state: 'awaiting_dependency',
      stateSinceAt: facts.pendingDependencySinceAt ?? facts.workUpdatedAt,
      trigger: 'await.pending',
      evidence: facts.pendingDependencyEvidence ?? 'A structured external dependency Await is pending.',
      authority: 'official_hook',
      responsible: 'dependency',
      nextAction: 'Inspect the dependency status or keep waiting for its structured signal.',
    }
  }

  if (facts.hasActiveRun || facts.sessionStatus === 'streaming') {
    return {
      state: 'running',
      stateSinceAt: facts.sessionUpdatedAt,
      trigger: 'runtime.active',
      evidence: 'Chat Runtime reports an active primary Agent Run.',
      authority: 'runtime_integration',
      responsible: 'agent',
      nextAction: 'Let the Agent Run continue unless intervention is required.',
    }
  }

  if (facts.pullRequest?.state === 'open' && !facts.pullRequest.isDraft) {
    return {
      state: 'merging',
      stateSinceAt: facts.pullRequest.updatedAt,
      trigger: 'pull_request.ready',
      evidence: 'The bound pull request is open and marked ready for review.',
      authority: 'official_hook',
      responsible: 'user',
      nextAction: 'Complete review checks and merge or return the Work for changes.',
    }
  }

  const preparedAfterSubmit = facts.preparedAt !== null
    && (facts.lastSubmittedAt === null || facts.preparedAt > facts.lastSubmittedAt)
  if (preparedAfterSubmit || facts.pullRequest?.state === 'open') {
    return {
      state: 'ready_for_review',
      stateSinceAt: Math.max(
        facts.preparedAt ?? 0,
        facts.pullRequest?.updatedAt ?? 0,
        facts.workUpdatedAt,
      ),
      trigger: 'delivery.prepared',
      evidence: preparedAfterSubmit
        ? 'The Agent prepared a newer handoff than the last submitted pull request.'
        : 'A Draft pull request exists for this Work.',
      authority: facts.pullRequest ? 'official_hook' : 'runtime_integration',
      responsible: 'user',
      nextAction: 'Review the committed diff and publish or update the Draft pull request.',
    }
  }

  if (facts.lastSubmittedAt !== null) {
    return {
      state: 'verifying',
      stateSinceAt: facts.lastSubmittedAt,
      trigger: 'delivery.submitted',
      evidence: 'Delivery metadata was submitted, but no current pull request fact is available.',
      authority: 'derived',
      responsible: 'system',
      nextAction: 'Redetect GitHub state and verify the delivery evidence.',
    }
  }

  return {
    state: 'unknown',
    stateSinceAt: facts.workUpdatedAt,
    trigger: 'state.unknown',
    evidence: 'The runtime is idle and no structured delivery, wait, failure, or review fact exists.',
    authority: 'derived',
    responsible: 'system',
    nextAction: 'Redetect state, inspect the latest Agent output, or ask the Agent to prepare delivery.',
  }
}

function deriveRecovery(facts: WorkProjectionFacts): WorkRecovery {
  if (facts.hasActiveRun) {
    return {
      level: 'live',
      evidence: 'Chat Runtime currently owns an active run for the primary Session.',
      lastHeartbeatAt: facts.sessionUpdatedAt,
    }
  }
  if (facts.hasDurableProviderBinding) {
    return {
      level: 'resumable',
      evidence: 'The provider runtime has a durable session binding that supports resume.',
      lastHeartbeatAt: facts.sessionUpdatedAt,
    }
  }
  if (facts.isIsolated && facts.worktreeHealth === 'ok') {
    return {
      level: 'reproducible',
      evidence: 'A healthy managed worktree retains the repository execution boundary.',
      lastHeartbeatAt: facts.workUpdatedAt,
    }
  }
  if (facts.hasPersistedSession) {
    return {
      level: 'restorable',
      evidence: 'Cradle retains the primary Session and its persisted transcript.',
      lastHeartbeatAt: facts.sessionUpdatedAt,
    }
  }
  return {
    level: 'unknown',
    evidence: 'No live run, durable provider binding, persisted Session, or healthy checkout was detected.',
    lastHeartbeatAt: null,
  }
}

export function deriveWorkProjection(facts: WorkProjectionFacts): WorkProjection {
  const selected = selectState(facts)
  return {
    state: selected.state,
    stateSinceAt: selected.stateSinceAt,
    explanation: {
      trigger: selected.trigger,
      evidence: selected.evidence,
      authority: selected.authority,
      responsible: selected.responsible,
      nextAction: selected.nextAction,
      observedAt: facts.observedAt,
    },
    recovery: deriveRecovery(facts),
  }
}
