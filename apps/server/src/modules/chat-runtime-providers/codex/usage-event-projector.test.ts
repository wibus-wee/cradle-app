import { describe, expect, it } from 'vitest'

import type { ServerNotification } from './app-server-protocol/ServerNotification'
import type { TokenUsageBreakdown } from './app-server-protocol/v2/TokenUsageBreakdown'
import { CodexUsageEventProjectionError, CodexUsageEventProjector } from './usage-event-projector'

describe('codexUsageEventProjector', () => {
  it('projects every model call from last usage with stable replay identity', () => {
    const projector = new CodexUsageEventProjector('gpt-5.6-sol', () => 1_789_000_000)
    const first = projector.project(tokenUsageNotification('thread-1', 'turn-1', usage(100, 10), usage(100, 10)))
    const secondNotification = tokenUsageNotification('thread-1', 'turn-1', usage(180, 20), usage(80, 10))
    const second = projector.project(secondNotification)
    const replay = projector.project(secondNotification)

    expect(first).toMatchObject({
      providerThreadId: 'thread-1',
      providerTurnId: 'turn-1',
      modelId: 'gpt-5.6-sol',
      occurredAt: 1_789_000_000,
      usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
    })
    expect(second).toMatchObject({ usage: { promptTokens: 80, completionTokens: 10, totalTokens: 90 } })
    expect(replay?.id).toBe(second?.id)
    expect(first?.id).not.toBe(second?.id)
  })

  it('preserves cached and reasoning subsets without adding them to total', () => {
    const projector = new CodexUsageEventProjector('gpt-5.6-sol')
    const event = projector.project(tokenUsageNotification(
      'thread-1',
      'turn-1',
      usage(500, 50, 400, 20),
      usage(200, 30, 180, 10),
    ))

    expect(event?.usage).toEqual({
      promptTokens: 200,
      completionTokens: 30,
      totalTokens: 230,
      cachedInputTokens: 180,
      reasoningOutputTokens: 10,
    })
  })

  it('uses the rerouted model for the matching provider turn', () => {
    const projector = new CodexUsageEventProjector('gpt-5.6-sol')
    projector.project({
      method: 'model/rerouted',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        fromModel: 'gpt-5.6-sol',
        toModel: 'gpt-5.6-mini',
        reason: 'highRiskCyberActivity',
      },
    } as ServerNotification)

    expect(projector.project(tokenUsageNotification('thread-1', 'turn-1', usage(100, 10), usage(100, 10)))?.modelId)
      .toBe('gpt-5.6-mini')
    expect(projector.project(tokenUsageNotification('thread-2', 'turn-2', usage(100, 10), usage(100, 10)))?.modelId)
      .toBe('gpt-5.6-sol')
  })

  it('retains descendant thread and turn identity', () => {
    const projector = new CodexUsageEventProjector('gpt-5.6-sol')
    const event = projector.project(tokenUsageNotification('nested-child', 'child-turn', usage(50, 5), usage(50, 5)))

    expect(event).toMatchObject({
      providerThreadId: 'nested-child',
      providerTurnId: 'child-turn',
      modelId: 'gpt-5.6-sol',
    })
  })

  it('rejects usage without a model or positive call total', () => {
    const missingModel = new CodexUsageEventProjector(null)
    expect(() => missingModel.project(tokenUsageNotification('thread-1', 'turn-1', usage(10, 1), usage(10, 1))))
      .toThrow(CodexUsageEventProjectionError)

    const projector = new CodexUsageEventProjector('gpt-5.6-sol')
    expect(() => projector.project(tokenUsageNotification('thread-1', 'turn-1', usage(10, 1), usage(0, 0))))
      .toThrow('positive model-call total')
  })
})

function tokenUsageNotification(
  threadId: string,
  turnId: string,
  total: TokenUsageBreakdown,
  last: TokenUsageBreakdown,
): ServerNotification {
  return {
    method: 'thread/tokenUsage/updated',
    params: {
      threadId,
      turnId,
      tokenUsage: { total, last, modelContextWindow: 400_000 },
    },
  }
}

function usage(
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
  reasoningOutputTokens = 0,
): TokenUsageBreakdown {
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens: 0,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: inputTokens + outputTokens,
  }
}
