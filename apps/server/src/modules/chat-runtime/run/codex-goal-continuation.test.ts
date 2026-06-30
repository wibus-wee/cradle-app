import type { BackendSessionBinding } from '@cradle/db'
import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  hasContinuableCodexGoal,
  shouldScheduleCodexGoalContinuation,
} from './codex-goal-continuation'

function createGoalSnapshot(status: string, objective = 'Ship the goal'): string {
  return JSON.stringify({
    codex: {
      goal: {
        threadId: 'codex-thread-1',
        objective,
        status,
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 2,
      },
    },
  })
}

function createBinding(status: string): BackendSessionBinding {
  return {
    runtimeKind: 'codex',
    backendStateSnapshot: createGoalSnapshot(status),
  } as BackendSessionBinding
}

const finishChunk = { type: 'finish' } as UIMessageChunk

describe('hasContinuableCodexGoal', () => {
  it('continues active goals by default', () => {
    expect(hasContinuableCodexGoal(createGoalSnapshot('active'))).toBe(true)
  })

  it('does not continue blocked goals by default', () => {
    expect(hasContinuableCodexGoal(createGoalSnapshot('blocked'))).toBe(false)
  })

  it('continues blocked goals when the blocked-goal flag is enabled', () => {
    expect(
      hasContinuableCodexGoal(createGoalSnapshot('blocked'), {
        continueBlockedGoals: true,
      }),
    ).toBe(true)
  })

  it('does not continue terminal or empty-objective goals', () => {
    expect(
      hasContinuableCodexGoal(createGoalSnapshot('complete'), {
        continueBlockedGoals: true,
      }),
    ).toBe(false)
    expect(
      hasContinuableCodexGoal(createGoalSnapshot('blocked', '   '), {
        continueBlockedGoals: true,
      }),
    ).toBe(false)
  })
})

describe('shouldScheduleCodexGoalContinuation', () => {
  it('does not schedule blocked goals unless the feature flag is enabled', () => {
    const baseInput = {
      run: {
        sessionId: 'session-1',
        runtimeKind: 'codex',
        cancelRequested: false,
      },
      finalChunk: finishChunk,
      binding: createBinding('blocked'),
      providerTargetAvailable: true,
      pendingQueueItemCount: 0,
    }

    expect(shouldScheduleCodexGoalContinuation(baseInput)).toBe(false)
    expect(
      shouldScheduleCodexGoalContinuation({
        ...baseInput,
        continueBlockedGoals: true,
      }),
    ).toBe(true)
  })
})
