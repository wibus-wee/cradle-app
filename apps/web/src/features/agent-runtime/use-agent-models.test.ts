// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
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
  useProviderTargetModels,
} from './use-agent-models'

const apiMocks = vi.hoisted(() => ({
  getModelSettings: vi.fn(),
  getModelsCache: vi.fn(),
  postModels: vi.fn(),
  getTargets: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', () => ({
  getProfilesById: vi.fn(),
  getProvidersByProfileIdModelsCache: vi.fn(),
  getProviderTargetsByProviderTargetIdModelSettings: apiMocks.getModelSettings,
  getProvidersTargetsByProviderTargetIdModelsCache: apiMocks.getModelsCache,
  postProvidersModels: apiMocks.postModels,
  getProviderTargets: apiMocks.getTargets,
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
  apiMocks.getTargets.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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

  it('isolates the same provider ID on different remote nodes and workspaces', () => {
    const target = { id: 'same-provider' }
    expect(providerTargetModelsQueryKey(target, 'workspace-1', 'node-1'))
      .not
.toEqual(providerTargetModelsQueryKey(target, 'workspace-1', 'node-2'))
    expect(providerTargetModelsQueryKey(target, 'workspace-1', 'node-1'))
      .not
.toEqual(providerTargetModelsQueryKey(target, 'workspace-2', 'node-1'))
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

  it('accepts a fresh empty server cache', () => {
    expect(shouldLiveRefreshModelInventory({
      cached: true,
      stale: false,
      coolingDown: false,
      models: [],
    })).toBe(false)
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
  const target = {
    id: 'shared-provider',
    kind: 'external' as const,
    enabled: true,
    name: 'Shared Provider',
    providerKind: 'openai-compatible' as const,
    enabledModelsJson: '["obsolete-model"]',
  }
  const model = (id: string) => ({ id, label: id, providerKind: 'openai-compatible', capabilities: {} })
  const cache = (ids: string[], stale = false) => ({
    data: { models: ids.map(model), cached: true, stale, coolingDown: false, providerLabel: target.name },
  })
  function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const mount = () => renderHook(() => useProviderTargetModelMap([target], [target.id]), { wrapper })
    return { queryClient, mount }
  }

  it('reloads an inactive invalidated catalog when a selector remounts', async () => {
    apiMocks.getModelsCache.mockResolvedValue(cache(['old']))
    const { queryClient, mount } = setup()
    const first = mount()
    await waitFor(() => expect(first.result.current.modelsByProviderTargetId[target.id]).toEqual([model('old')]))
    first.unmount()
    apiMocks.getModelsCache.mockResolvedValue(cache(['new']))
    await queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
    const second = mount()
    await waitFor(() => expect(second.result.current.modelsByProviderTargetId[target.id]).toEqual([model('new')]))
    expect(apiMocks.postModels).not.toHaveBeenCalled()
  })

  it('applies current visibility to every mounted selector after settings invalidate', async () => {
    apiMocks.getModelsCache.mockResolvedValue(cache(['one', 'two']))
    const { queryClient, mount } = setup()
    const first = mount()
    const second = mount()
    await waitFor(() => expect(first.result.current.modelsByProviderTargetId[target.id]).toHaveLength(2))
    apiMocks.getModelSettings.mockResolvedValue({ data: { configJson: '{"enabledModels":["two"]}' } })
    await act(() => queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }))
    await waitFor(() => {
      expect(first.result.current.modelsByProviderTargetId[target.id]).toEqual([model('two')])
      expect(second.result.current.modelsByProviderTargetId[target.id]).toEqual([model('two')])
    })
  })

  it('revalidates an expired frontend cache on menu open without live-fetching a fresh server catalog', async () => {
    apiMocks.getModelsCache.mockResolvedValue(cache(['new']))
    const { queryClient, mount } = setup()
    const { result } = mount()
    await waitFor(() => expect(result.current.modelsByProviderTargetId[target.id]).toEqual([model('new')]))
    act(() => queryClient.setQueryData(providerTargetModelsQueryKey(target), [model('old')], { updatedAt: Date.now() - 61_000 }))
    act(() => result.current.requestProviderTargetModels(target.id))
    await waitFor(() => expect(result.current.modelsByProviderTargetId[target.id]).toEqual([model('new')]))
    expect(apiMocks.postModels).not.toHaveBeenCalled()
  })

  it('deduplicates live refreshes across selectors and settles an empty result', async () => {
    apiMocks.getModelsCache.mockResolvedValue(cache([], true))
    let finish!: () => void
    apiMocks.postModels.mockReturnValue(new Promise((resolve) => { finish = () => resolve({ data: [] }) }))
    const { queryClient, mount } = setup()
    const first = mount()
    const second = mount()
    await waitFor(() => expect(apiMocks.postModels).toHaveBeenCalledTimes(1))
    act(() => {
      first.result.current.requestProviderTargetModels(target.id, { refresh: true })
      second.result.current.requestProviderTargetModels(target.id, { refresh: true })
      finish()
    })
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(apiMocks.postModels).toHaveBeenCalledTimes(1)
    expect(first.result.current.modelsByProviderTargetId[target.id]).toEqual([])
  })

  it('cancels an older live request when settings publish a newer catalog', async () => {
    apiMocks.getModelsCache.mockResolvedValue(cache(['old'], true))
    let finish!: () => void
    apiMocks.postModels.mockReturnValue(new Promise((resolve) => { finish = () => resolve({ data: [model('obsolete')] }) }))
    const { queryClient, mount } = setup()
    const { result } = mount()
    await waitFor(() => expect(apiMocks.postModels).toHaveBeenCalledTimes(1))
    const signal = apiMocks.postModels.mock.calls[0][0].signal as AbortSignal
    apiMocks.getModelsCache.mockResolvedValue(cache(['new']))
    await act(() => queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }))
    expect(signal.aborted).toBe(true)
    await act(async () => finish())
    await waitFor(() => expect(result.current.modelsByProviderTargetId[target.id]).toEqual([model('new')]))
  })

  it('reports explicit refresh failures and preserves the previous catalog', async () => {
    apiMocks.getModelsCache.mockResolvedValue(cache(['old']))
    apiMocks.postModels.mockRejectedValue(new Error('provider unavailable'))
    const toast = vi.spyOn(toastManager, 'add')
    const { mount } = setup()
    const { result } = mount()
    await waitFor(() => expect(result.current.modelsByProviderTargetId[target.id]).toEqual([model('old')]))
    act(() => result.current.requestProviderTargetModels(target.id, { refresh: true }))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(result.current.modelsByProviderTargetId[target.id]).toEqual([model('old')])
    act(() => result.current.requestProviderTargetModels(target.id))
    expect(apiMocks.postModels).toHaveBeenCalledTimes(1)
    apiMocks.postModels.mockResolvedValue({ data: [model('new')] })
    act(() => result.current.requestProviderTargetModels(target.id, { refresh: true }))
    await waitFor(() => expect(result.current.modelsByProviderTargetId[target.id]).toEqual([model('new')]))
  })

  it('uses the same refresh policy when an ID-only session observer mounts first', async () => {
    apiMocks.getModelsCache.mockResolvedValue(cache(['old'], true))
    apiMocks.getTargets.mockResolvedValue({ data: [{ ...target, displayName: target.name }] })
    let finish!: () => void
    apiMocks.postModels.mockReturnValue(new Promise((resolve) => { finish = () => resolve({ data: [model('new')] }) }))
    const { queryClient, mount } = setup()
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const session = renderHook(() => useProviderTargetModels({ id: target.id }), { wrapper })
    await waitFor(() => expect(apiMocks.postModels).toHaveBeenCalledTimes(1))
    const picker = mount()
    act(() => finish())
    await waitFor(() => {
      expect(session.result.current.models).toEqual([model('new')])
      expect(picker.result.current.modelsByProviderTargetId[target.id]).toEqual([model('new')])
    })
    expect(apiMocks.postModels).toHaveBeenCalledTimes(1)
  })

  it('honors server cooldown until an explicit refresh', async () => {
    apiMocks.getModelsCache.mockResolvedValue({ data: { ...cache([], true).data, coolingDown: true } })
    apiMocks.postModels.mockResolvedValue({ data: [model('new')] })
    const { mount } = setup()
    const { result } = mount()
    await waitFor(() => expect(result.current.successfulProviderTargetIds.has(target.id)).toBe(true))
    expect(apiMocks.postModels).not.toHaveBeenCalled()
    act(() => result.current.requestProviderTargetModels(target.id, { refresh: true }))
    await waitFor(() => expect(result.current.modelsByProviderTargetId[target.id]).toEqual([model('new')]))
  })

  it('preserves frontend inventory during refresh when no durable server cache exists', async () => {
    const { queryClient, mount } = setup()
    queryClient.setQueryData(providerTargetModelsQueryKey(target), [model('old')], { updatedAt: Date.now() - 61_000 })
    let finish!: () => void
    apiMocks.postModels.mockReturnValue(new Promise((resolve) => { finish = () => resolve({ data: [model('new')] }) }))
    const { result } = mount()
    await waitFor(() => expect(apiMocks.postModels).toHaveBeenCalledTimes(1))
    expect(result.current.modelsByProviderTargetId[target.id]).toEqual([model('old')])
    expect(result.current.loadingProviderTargetIds.has(target.id)).toBe(false)
    act(() => finish())
    await waitFor(() => expect(result.current.modelsByProviderTargetId[target.id]).toEqual([model('new')]))
  })

  it('reads current visibility and keeps cached models out of loading state', async () => {
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
    expect(apiMocks.getModelSettings).toHaveBeenCalledTimes(1)
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
