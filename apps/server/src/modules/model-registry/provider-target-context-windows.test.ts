import { afterEach, describe, expect, it } from 'vitest'

import type { ModelCapabilities } from '../provider-contracts/types'
import {
  clearAllProviderTargetContextWindows,
  clearProviderTargetContextWindows,
  getProviderTargetContextWindow,
  replaceProviderTargetContextWindows,
} from './provider-target-context-windows'

function model(id: string, capabilities: ModelCapabilities = {}) {
  return { id, capabilities }
}

afterEach(() => {
  clearAllProviderTargetContextWindows()
})

describe('provider target context windows', () => {
  it('keeps the same model id separate per provider target', () => {
    replaceProviderTargetContextWindows('target-magpie', [
      model('codex/gpt-6.2-sol', { contextWindow: 500_000 }),
    ])
    replaceProviderTargetContextWindows('target-proxy', [
      model('codex/gpt-6.2-sol', { contextWindow: 200_000 }),
    ])

    expect(getProviderTargetContextWindow('target-magpie', 'codex/gpt-6.2-sol')).toBe(500_000)
    expect(getProviderTargetContextWindow('target-proxy', 'codex/gpt-6.2-sol')).toBe(200_000)
    expect(getProviderTargetContextWindow('target-unknown', 'codex/gpt-6.2-sol')).toBeNull()
    expect(getProviderTargetContextWindow(null, 'codex/gpt-6.2-sol')).toBeNull()
  })

  it('replaces the whole target inventory so delisted models lose their window', () => {
    replaceProviderTargetContextWindows('target-magpie', [
      model('a', { contextWindow: 1_000_000 }),
      model('b', { contextWindow: 128_000 }),
    ])
    replaceProviderTargetContextWindows('target-magpie', [
      model('b', { contextWindow: 128_000 }),
    ])

    expect(getProviderTargetContextWindow('target-magpie', 'a')).toBeNull()
    expect(getProviderTargetContextWindow('target-magpie', 'b')).toBe(128_000)
  })

  it('ignores models that declare no usable window and drops a target left with none', () => {
    replaceProviderTargetContextWindows('target-magpie', [
      model('undeclared'),
      model('zero', { contextWindow: 0 }),
      model('fractional', { contextWindow: 262_144.9 }),
      model('declared', { contextWindow: 500_000 }),
    ])

    expect(getProviderTargetContextWindow('target-magpie', 'undeclared')).toBeNull()
    expect(getProviderTargetContextWindow('target-magpie', 'zero')).toBeNull()
    expect(getProviderTargetContextWindow('target-magpie', 'fractional')).toBe(262_144)
    expect(getProviderTargetContextWindow('target-magpie', 'declared')).toBe(500_000)

    replaceProviderTargetContextWindows('target-magpie', [model('undeclared')])
    expect(getProviderTargetContextWindow('target-magpie', 'declared')).toBeNull()
  })

  it('forgets a target when its inventory is deleted', () => {
    replaceProviderTargetContextWindows('target-magpie', [model('a', { contextWindow: 1_000_000 })])
    clearProviderTargetContextWindows('target-magpie')

    expect(getProviderTargetContextWindow('target-magpie', 'a')).toBeNull()
  })
})
