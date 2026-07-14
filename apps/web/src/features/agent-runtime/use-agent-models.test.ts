// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import {
  AGENT_MODELS_QUERY_KEY,
  agentModelsQueryKey,
  isRuntimeOwnedProviderTarget,
  providerTargetModelsQueryKey,
  shouldLiveRefreshModelInventory,
} from './use-agent-models'

describe('agentModelsQueryKey', () => {
  it('uses one stable cache slot per profile', () => {
    expect(agentModelsQueryKey('profile-1')).toEqual([...AGENT_MODELS_QUERY_KEY, 'profile-1'])
  })

  it('uses a stable disabled-query key for empty profile selection', () => {
    expect(agentModelsQueryKey(null)).toEqual([...AGENT_MODELS_QUERY_KEY, 'no-profile'])
  })
})

describe('providerTargetModelsQueryKey', () => {
  it('uses one stable cache slot per provider target', () => {
    expect(providerTargetModelsQueryKey({ kind: 'external', id: 'target-1' })).toEqual([
      ...AGENT_MODELS_QUERY_KEY,
      'provider-target:target-1',
    ])
  })

  it('uses a stable disabled-query key for empty target selection', () => {
    expect(providerTargetModelsQueryKey(null)).toEqual([
      ...AGENT_MODELS_QUERY_KEY,
      'no-provider-target',
    ])
  })

  it('can scope provider target cache by workspace', () => {
    expect(providerTargetModelsQueryKey({ kind: 'external', id: 'target-1' }, 'workspace-1')).toEqual([
      ...AGENT_MODELS_QUERY_KEY,
      'provider-target:target-1',
      'workspace:workspace-1',
    ])
  })
})

describe('isRuntimeOwnedProviderTarget', () => {
  it('identifies runtime-owned provider targets', () => {
    expect(isRuntimeOwnedProviderTarget({
      id: 'runtime-native:opencode:opencode-go',
    })).toBe(true)
  })

  it('identifies provider targets from runtime-owned sources', () => {
    expect(isRuntimeOwnedProviderTarget({
      id: 'projected-provider',
      sourceKey: 'runtime-native:opencode',
    })).toBe(true)
  })

  it('excludes ordinary provider targets', () => {
    expect(isRuntimeOwnedProviderTarget({
      id: 'manual-provider',
      sourceKey: 'external-source:local-agent-config',
    })).toBe(false)
  })
})

describe('shouldLiveRefreshModelInventory', () => {
  it('live-refreshes when the server cache is missing', () => {
    expect(shouldLiveRefreshModelInventory({
      cached: false,
      stale: false,
      coolingDown: false,
      models: [],
    })).toBe(true)
  })

  it('live-refreshes when the server cache is empty', () => {
    expect(shouldLiveRefreshModelInventory({
      cached: true,
      stale: false,
      coolingDown: false,
      models: [],
    })).toBe(true)
  })

  it('live-refreshes when the server cache is stale', () => {
    expect(shouldLiveRefreshModelInventory({
      cached: true,
      stale: true,
      coolingDown: false,
      models: [{ id: 'model-1' }],
    })).toBe(true)
  })

  it('keeps a warm non-empty cache without live refresh', () => {
    expect(shouldLiveRefreshModelInventory({
      cached: true,
      stale: false,
      coolingDown: false,
      models: [{ id: 'model-1' }],
    })).toBe(false)
  })

  it('does not retry while the server is cooling down after a failed refresh', () => {
    expect(shouldLiveRefreshModelInventory({
      cached: false,
      stale: false,
      coolingDown: true,
      models: [],
    })).toBe(false)
  })
})
