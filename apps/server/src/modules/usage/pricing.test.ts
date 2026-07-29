import { describe, expect, it, vi } from 'vitest'

vi.mock('../model-registry/model-info-registry', () => ({
  getCachedModelsDevCost: (modelId: string) => modelId === 'cached-model'
    ? { input: 10, output: 20, cacheRead: 1, cacheWrite: 12 }
    : { input: 10, output: 20 },
}))

const { estimateCost, estimateCostBreakdown } = await import('./pricing')

describe('usage pricing', () => {
  it('prices uncached, cache-read, cache-write, and output tokens separately', () => {
    const usage = {
      promptTokens: 1_000,
      cachedInputTokens: 600,
      cacheWriteInputTokens: 100,
      completionTokens: 100,
    }
    expect(estimateCost('cached-model', usage)).toBeCloseTo(0.0068)
    expect(estimateCostBreakdown('cached-model', usage)).toEqual({
      uncachedInputTokens: 300,
      uncachedInputCostUsd: 0.003,
      cacheReadCostUsd: 0.0006,
      cacheWriteCostUsd: 0.0012,
      outputCostUsd: 0.002,
      totalCostUsd: 0.0068,
    })
  })

  it('falls cache subsets back to normal input pricing when the registry omits cache rates', () => {
    expect(estimateCost('input-only-model', {
      promptTokens: 1_000,
      cachedInputTokens: 600,
      cacheWriteInputTokens: 100,
      completionTokens: 100,
    })).toBeCloseTo(0.012)
  })
})
