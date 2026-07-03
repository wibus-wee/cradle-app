import type { BackendSessionBinding } from '@cradle/db'
import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { createCodexGoalContinuation } from '../../chat-runtime-providers/codex/goal-continuation'
import type { ChatRuntime } from '../runtime-provider-types'
import {
  hasContinuableRuntimeGoal,
  shouldScheduleRuntimeGoalContinuation,
} from './runtime-goal-continuation'

const runtime = {
  runtimeKind: 'codex',
  goalContinuation: createCodexGoalContinuation(),
} as ChatRuntime

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

describe('hasContinuableRuntimeGoal', () => {
  it('continues active goals by default through the runtime hook', () => {
    expect(hasContinuableRuntimeGoal({
      runtime,
      binding: createBinding('active'),
    })).toBe(true)
  })

  it('does not continue blocked goals by default', () => {
    expect(hasContinuableRuntimeGoal({
      runtime,
      binding: createBinding('blocked'),
    })).toBe(false)
  })

  it('continues blocked goals when the blocked-goal option is enabled', () => {
    expect(hasContinuableRuntimeGoal({
      runtime,
      binding: createBinding('blocked'),
      options: {
        includeBlockedGoals: true,
      },
    })).toBe(true)
  })

  it('does not continue terminal or empty-objective goals', () => {
    expect(hasContinuableRuntimeGoal({
      runtime,
      binding: createBinding('complete'),
      options: {
        includeBlockedGoals: true,
      },
    })).toBe(false)
    expect(hasContinuableRuntimeGoal({
      runtime,
      binding: {
        ...createBinding('blocked'),
        backendStateSnapshot: createGoalSnapshot('blocked', '   '),
      },
      options: {
        includeBlockedGoals: true,
      },
    })).toBe(false)
  })
})

describe('shouldScheduleRuntimeGoalContinuation', () => {
  it('does not schedule blocked goals unless the option is enabled', () => {
    const baseInput = {
      run: {
        sessionId: 'session-1',
        runtime,
        cancelRequested: false,
      },
      finalChunk: finishChunk,
      binding: createBinding('blocked'),
      providerTargetAvailable: true,
      pendingQueueItemCount: 0,
    }

    expect(shouldScheduleRuntimeGoalContinuation(baseInput)).toBe(false)
    expect(
      shouldScheduleRuntimeGoalContinuation({
        ...baseInput,
        options: {
          includeBlockedGoals: true,
        },
      }),
    ).toBe(true)
  })
})
