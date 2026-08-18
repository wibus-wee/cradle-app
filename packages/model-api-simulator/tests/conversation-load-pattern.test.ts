import { describe, expect, it } from 'vitest'

import {
  createConversationAssistantReply,
  createConversationFollowUp,
  createGrowingConversationLoadPattern,
  createInitialConversationHistory,
  estimateConversationTokens,
} from '../src/conversation-load-pattern'

describe('growing conversation load pattern', () => {
  it('replays complete history and reaches the configured context envelope', () => {
    const pattern = createGrowingConversationLoadPattern({
      durationMs: 30_000,
      followUpIntervalMs: 5_000,
      targetContextTokens: 20_000,
      initialContextTokens: 2_000,
      responseTokensPerTurn: 200,
    })
    const history = createInitialConversationHistory(pattern)
    const requestSizes: number[] = []

    for (let turn = 0; turn < pattern.turnCount; turn += 1) {
      history.push(createConversationFollowUp(pattern, turn, history))
      requestSizes.push(estimateConversationTokens(history))
      history.push(createConversationAssistantReply(pattern, turn))
    }

    expect(requestSizes).toHaveLength(6)
    expect(requestSizes.every((size, index) => index === 0 || size > requestSizes[index - 1]!)).toBe(true)
    expect(requestSizes.at(-1)).toBe(pattern.targetContextTokens)
    expect(estimateConversationTokens(history)).toBe(
      pattern.targetContextTokens + pattern.responseTokensPerTurn,
    )
  })

  it('rejects a response stream that overlaps the next scheduled follow-up', () => {
    expect(() => createGrowingConversationLoadPattern({
      durationMs: 30_000,
      targetContextTokens: 20_000,
      followUpIntervalMs: 100,
      streamChunksPerTurn: 10,
      streamChunkIntervalMs: 10,
    })).toThrow('must complete before the next follow-up')
  })
})
