// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toastManager } from '~/components/ui/toast'

import {
  AGENT_MODELS_QUERY_KEY,
  agentModelsQueryKey,
  isRuntimeOwnedProviderTarget,
  providerTargetModelsQueryKey,
  shouldLiveRefreshModelInventory,
  useProviderTargetModelMap,
} from './use-agent-models'

const apiMocks = vi.hoisted(() => ({
  getModelSettings: vi.fn(),
  getModelsCache: vi.fn(),
  postModels: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', () => ({
  getProfilesById: vi.fn(),
  getProvidersByProfileIdModelsCache: vi.fn(),
  getProviderTargetsByProviderTargetIdModelSettings: apiMocks.getModelSettings,
  getProvidersTargetsByProviderTargetIdModelsCache: apiMocks.getModelsCache,
  postProvidersModels: apiMocks.postModels,
}))

beforeEach(() => {
  apiMocks.getModelSettings.mockReset().mockResolvedValue({
    data: { configJson: JSON.stringify({ enabledModels: [] }) },
  })
  apiMocks.getModelsCache.mockReset().mockResolvedValue({
    data: {
      models: [],
      cached: false,
      stale: false,
      coolingDown: false,
      providerLabel: 'Provider 1',
    },
  })
  apiMocks.postModels.mockReset()
})

afterEach(() => vi.restoreAllMocks())

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

  it('reuses ordinary local provider target cache across workspaces', () => {
    expect(providerTargetModelsQueryKey({ kind: 'external', id: 'target-1' }, 'workspace-1')).toEqual([
      ...AGENT_MODELS_QUERY_KEY,
      'provider-target:target-1',
    ])
  })

  it('scopes runtime-owned provider target cache by workspace', () => {
    expect(providerTargetModelsQueryKey({ kind: 'external', id: 'runtime-native:opencode:test' }, 'workspace-1')).toEqual([
      ...AGENT_MODELS_QUERY_KEY,
      'provider-target:runtime-native:opencode:test',
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

describe('useProviderTargetModelMap', () => {
  it('uses the provider-target cache directly and keeps cached models out of loading state', async () => {
    let rejectRefresh!: (reason: Error) => void
    apiMocks.getModelsCache.mockResolvedValue({
      data: {
        models: [{
          id: 'cached-model',
          label: 'Cached Model',
          providerKind: 'openai-compatible',
          capabilities: {},
        }],
        cached: true,
        stale: true,
        coolingDown: false,
        providerLabel: 'Provider 1',
      },
    })
    apiMocks.postModels.mockReturnValue(new Promise((_, reject) => {
      rejectRefresh = reject
    }))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const target = {
      id: 'provider-1',
      kind: 'external' as const,
      enabled: true,
      name: 'Provider 1',
      providerKind: 'openai-compatible' as const,
      enabledModelsJson: '[]',
    }
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useProviderTargetModelMap([target], [target.id]), { wrapper })

    await waitFor(() => expect(apiMocks.postModels).toHaveBeenCalledTimes(1))
    expect(apiMocks.getModelSettings).not.toHaveBeenCalled()
    expect(result.current.modelsByProviderTargetId[target.id]).toHaveLength(1)
    expect(result.current.loadingProviderTargetIds.has(target.id)).toBe(false)

    rejectRefresh(new Error('background refresh failed'))
    await waitFor(() => expect(result.current.loadingProviderTargetIds.has(target.id)).toBe(false))
  })

  it('settles the cache query before a background refresh and does not toast on refresh failure', async () => {
    let rejectRefresh!: (reason: Error) => void
    apiMocks.postModels.mockReturnValue(new Promise((_, reject) => {
      rejectRefresh = reject
    }))
    const toast = vi.spyOn(toastManager, 'add')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const target = {
      id: 'provider-1',
      kind: 'external' as const,
      enabled: true,
      name: 'Provider 1',
      providerKind: 'openai-compatible' as const,
    }
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useProviderTargetModelMap([target], [target.id]), { wrapper })

    await waitFor(() => expect(apiMocks.postModels).toHaveBeenCalledTimes(1))
    expect(queryClient.getQueryState(providerTargetModelsQueryKey(target))?.status).toBe('success')

    rejectRefresh(new Error('upstream unavailable'))
    await waitFor(() => expect(result.current.loadingProviderTargetIds.has(target.id)).toBe(false))
    expect(toast).not.toHaveBeenCalled()
    toast.mockRestore()
  })

  it('live-fetches runtime-owned targets that cannot have a durable cache', async () => {
    apiMocks.postModels.mockResolvedValue({
      data: [{
        id: 'runtime-model',
        label: 'Runtime Model',
        providerKind: 'universal',
        capabilities: {},
      }],
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const target = {
      id: 'runtime-native:opencode:test',
      kind: 'external' as const,
      enabled: true,
      name: 'Runtime Provider',
      providerKind: 'universal' as const,
    }
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useProviderTargetModelMap([target], [target.id]), { wrapper })

    await waitFor(() => expect(result.current.modelsByProviderTargetId[target.id]).toHaveLength(1))
    expect(apiMocks.postModels).toHaveBeenCalledTimes(1)
  })
})
