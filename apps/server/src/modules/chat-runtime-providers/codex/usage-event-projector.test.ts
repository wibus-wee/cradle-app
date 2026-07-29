import { describe, expect, it } from 'vitest'

import type { ServerNotification } from './app-server-protocol/ServerNotification'
import type { TokenUsageBreakdown } from './app-server-protocol/v2/TokenUsageBreakdown'
import {
  CodexUsageEventProjectionError,
  CodexUsageEventProjector,
  createCodexUsageEventId,
} from './usage-event-projector'

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

  it('pairs exact raw response usage and provider timestamp with the following cumulative update', () => {
    const projector = new CodexUsageEventProjector('gpt-5.6-sol', () => 1)
    expect(projector.project({
      method: 'rawResponse/completed',
      emittedAtMs: 1_789_000_123_456,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        responseId: 'response-1',
        usage: usage(123, 17, 100, 9, 5),
      },
    })).toBeNull()

    const event = projector.project(tokenUsageNotification(
      'thread-1',
      'turn-1',
      usage(500, 50, 400, 25, 20),
      usage(200, 30, 180, 15, 10),
    ))

    expect(event).toMatchObject({
      occurredAt: 1_789_000_123,
      usage: {
        promptTokens: 123,
        completionTokens: 17,
        totalTokens: 140,
        cachedInputTokens: 100,
        cacheWriteInputTokens: 9,
        reasoningOutputTokens: 5,
      },
      providerTotal: {
        promptTokens: 500,
        completionTokens: 50,
        totalTokens: 550,
      },
    })
  })

  it('falls back to the cumulative notification when exact raw usage is absent or null', () => {
    const projector = new CodexUsageEventProjector('gpt-5.6-sol', () => 1)
    projector.project({
      method: 'rawResponse/completed',
      emittedAtMs: 1_789_000_123_456,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        responseId: 'response-1',
        usage: null,
      },
    })
    const notification = tokenUsageNotification(
      'thread-1',
      'turn-1',
      usage(200, 30),
      usage(80, 10),
    )
    notification.emittedAtMs = 1_789_000_999_000

    expect(projector.project(notification)).toMatchObject({
      occurredAt: 1_789_000_999,
      usage: { promptTokens: 80, completionTokens: 10, totalTokens: 90 },
    })
  })

  it('preserves cache-read, cache-write, and reasoning subsets without adding them to total', () => {
    const projector = new CodexUsageEventProjector('gpt-5.6-sol')
    const event = projector.project(tokenUsageNotification(
      'thread-1',
      'turn-1',
      usage(500, 50, 400, 25, 20),
      usage(200, 30, 180, 15, 10),
    ))

    expect(event?.usage).toEqual({
      promptTokens: 200,
      completionTokens: 30,
      totalTokens: 230,
      cachedInputTokens: 180,
      cacheWriteInputTokens: 15,
      reasoningOutputTokens: 10,
    })
  })

  it('includes cache-write usage in the replay identity', () => {
    const withoutCacheWrite = usage(200, 30, 180, 0, 10)
    const withCacheWrite = usage(200, 30, 180, 15, 10)
    const withoutCacheWriteId = createCodexUsageEventId('thread-1', 'turn-1', withoutCacheWrite)
    const withCacheWriteId = createCodexUsageEventId('thread-1', 'turn-1', withCacheWrite)

    expect(withoutCacheWriteId).not.toBe(withCacheWriteId)
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
): ServerNotification & { emittedAtMs?: number } {
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
  cacheWriteInputTokens = 0,
  reasoningOutputTokens = 0,
): TokenUsageBreakdown {
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: inputTokens + outputTokens,
  }
}
