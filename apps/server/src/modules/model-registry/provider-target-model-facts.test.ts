import { afterEach, describe, expect, it } from 'vitest'

import type { ModelCapabilities } from '../provider-contracts/types'
import {
  clearAllProviderTargetModelFacts,
  clearProviderTargetModelFacts,
  getProviderTargetContextWindow,
  getProviderTargetServiceTierIds,
  replaceProviderTargetModelFacts,
} from './provider-target-model-facts'

function model(id: string, capabilities: ModelCapabilities = {}) {
  return { id, capabilities }
}

afterEach(() => {
  clearAllProviderTargetModelFacts()
})

describe('provider target model facts', () => {
  it('keeps the same model id separate per provider target', () => {
    replaceProviderTargetModelFacts('target-magpie', [
      model('codex/gpt-6.2-sol', { contextWindow: 500_000, serviceTiers: [{ id: 'priority', name: 'Fast' }] }),
    ])
    replaceProviderTargetModelFacts('target-proxy', [
      model('codex/gpt-6.2-sol', { contextWindow: 200_000 }),
    ])

    expect(getProviderTargetContextWindow('target-magpie', 'codex/gpt-6.2-sol')).toBe(500_000)
    expect(getProviderTargetContextWindow('target-proxy', 'codex/gpt-6.2-sol')).toBe(200_000)
    expect(getProviderTargetServiceTierIds('target-magpie', 'codex/gpt-6.2-sol')).toEqual(['priority'])
    // The second target never declared a tier, so no run there may request one.
    expect(getProviderTargetServiceTierIds('target-proxy', 'codex/gpt-6.2-sol')).toEqual([])
    expect(getProviderTargetContextWindow('target-unknown', 'codex/gpt-6.2-sol')).toBeNull()
    expect(getProviderTargetContextWindow(null, 'codex/gpt-6.2-sol')).toBeNull()
    expect(getProviderTargetServiceTierIds(null, 'codex/gpt-6.2-sol')).toEqual([])
  })

  it('replaces the whole target inventory so delisted models lose their facts', () => {
    replaceProviderTargetModelFacts('target-magpie', [
      model('a', { contextWindow: 1_000_000, serviceTiers: [{ id: 'priority', name: 'Fast' }] }),
      model('b', { contextWindow: 128_000 }),
    ])
    replaceProviderTargetModelFacts('target-magpie', [
      model('b', { contextWindow: 128_000 }),
    ])

    expect(getProviderTargetContextWindow('target-magpie', 'a')).toBeNull()
    expect(getProviderTargetServiceTierIds('target-magpie', 'a')).toEqual([])
    expect(getProviderTargetContextWindow('target-magpie', 'b')).toBe(128_000)
  })

  it('ignores models that declare no usable window or no tiers', () => {
    replaceProviderTargetModelFacts('target-magpie', [
      model('undeclared'),
      model('zero', { contextWindow: 0 }),
      model('fractional', { contextWindow: 262_144.9 }),
      model('tiered', {
        serviceTiers: [
          { id: 'priority', name: 'Fast' },
          { id: 'priority', name: 'Duplicated id' },
          { id: '', name: 'Empty id' },
          { id: 'ultrafast', name: 'Ultrafast' },
        ],
      }),
    ])

    expect(getProviderTargetContextWindow('target-magpie', 'undeclared')).toBeNull()
    expect(getProviderTargetContextWindow('target-magpie', 'zero')).toBeNull()
    expect(getProviderTargetContextWindow('target-magpie', 'fractional')).toBe(262_144)
    expect(getProviderTargetServiceTierIds('target-magpie', 'tiered')).toEqual(['priority', 'ultrafast'])

    replaceProviderTargetModelFacts('target-magpie', [model('undeclared')])
    expect(getProviderTargetContextWindow('target-magpie', 'fractional')).toBeNull()
    expect(getProviderTargetServiceTierIds('target-magpie', 'tiered')).toEqual([])
  })

  it('forgets a target when its inventory is deleted', () => {
    replaceProviderTargetModelFacts('target-magpie', [
      model('a', { contextWindow: 1_000_000, serviceTiers: [{ id: 'priority', name: 'Fast' }] }),
    ])
    clearProviderTargetModelFacts('target-magpie')

    expect(getProviderTargetContextWindow('target-magpie', 'a')).toBeNull()
    expect(getProviderTargetServiceTierIds('target-magpie', 'a')).toEqual([])
  })
})
