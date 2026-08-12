import { describe, expect, it } from 'vitest'

import type { WorkProjectionFacts } from './projection'
import { deriveWorkProjection } from './projection'

function facts(overrides: Partial<WorkProjectionFacts> = {}): WorkProjectionFacts {
  return {
    observedAt: 200,
    workUpdatedAt: 100,
    sessionUpdatedAt: 110,
    archivedAt: null,
    sessionArchivedAt: null,
    sessionStatus: 'idle',
    worktreeHealth: 'ok',
    isIsolated: true,
    hasPersistedSession: true,
    hasDurableProviderBinding: false,
    hasActiveRun: false,
    pendingHumanInteraction: false,
    pendingHumanSinceAt: null,
    pendingHumanEvidence: null,
    pendingDependency: false,
    pendingDependencySinceAt: null,
    pendingDependencyEvidence: null,
    preparedAt: null,
    lastSubmittedAt: null,
    pullRequest: null,
    ...overrides,
  }
}

describe('deriveWorkProjection', () => {
  it.each([
    [{ archivedAt: 150 }, 'archived', 'user_override', 'work.archived'],
    [{ pullRequest: { isDraft: false, state: 'closed', merged: true, updatedAt: 151 } }, 'done', 'official_hook', 'pull_request.merged'],
    [{ pullRequest: { isDraft: false, state: 'closed', merged: false, updatedAt: 152 } }, 'cancelled', 'official_hook', 'pull_request.closed'],
    [{ sessionStatus: 'error' }, 'failed', 'runtime_integration', 'session.error'],
    [{ worktreeHealth: 'missing' }, 'failed', 'official_hook', 'worktree.unhealthy'],
    [{ pendingHumanInteraction: true, pendingHumanSinceAt: 90 }, 'awaiting_human', 'runtime_integration', 'interaction.pending'],
    [{ pendingDependency: true, pendingDependencySinceAt: 80 }, 'awaiting_dependency', 'official_hook', 'await.pending'],
    [{ sessionStatus: 'streaming', hasActiveRun: true }, 'running', 'runtime_integration', 'runtime.active'],
    [{ pullRequest: { isDraft: false, state: 'open', merged: false, updatedAt: 160 } }, 'merging', 'official_hook', 'pull_request.ready'],
    [{ preparedAt: 170, lastSubmittedAt: 160 }, 'ready_for_review', 'runtime_integration', 'delivery.prepared'],
    [{ lastSubmittedAt: 170 }, 'verifying', 'derived', 'delivery.submitted'],
    [{}, 'unknown', 'derived', 'state.unknown'],
  ] as const)('selects %s as %s with explicit provenance', (overrides, state, authority, trigger) => {
    const projection = deriveWorkProjection(facts(overrides))

    expect(projection.state).toBe(state)
    expect(projection.explanation).toMatchObject({ authority, trigger, observedAt: 200 })
    expect(projection.explanation.evidence.length).toBeGreaterThan(0)
    expect(projection.explanation.nextAction.length).toBeGreaterThan(0)
  })

  it('keeps failure above pending interaction and active runtime', () => {
    const projection = deriveWorkProjection(facts({
      sessionStatus: 'error',
      pendingHumanInteraction: true,
      pendingDependency: true,
      hasActiveRun: true,
    }))

    expect(projection.state).toBe('failed')
    expect(projection.explanation.trigger).toBe('session.error')
  })

  it.each([
    [{ hasActiveRun: true, hasDurableProviderBinding: true }, 'live'],
    [{ hasDurableProviderBinding: true }, 'resumable'],
    [{}, 'reproducible'],
    [{ isIsolated: false, worktreeHealth: null }, 'restorable'],
    [{ isIsolated: false, worktreeHealth: null, hasPersistedSession: false }, 'unknown'],
  ] as const)('derives a truthful recovery promise from %s', (overrides, level) => {
    expect(deriveWorkProjection(facts(overrides)).recovery.level).toBe(level)
  })
})
