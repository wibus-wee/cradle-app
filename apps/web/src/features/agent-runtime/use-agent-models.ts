import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import {
  getProfilesById,
  getProvidersByProfileIdModelsCache,
  getProvidersTargetsByProviderTargetIdModelsCache,
  getProviderTargetsByProviderTargetIdModelSettings,
  postProvidersModels,
} from '~/api-gen/sdk.gen'
import { toastManager } from '~/components/ui/toast'
import type { AgentProfile, ApiProviderKind, ModelDescriptor, ProviderKind, ProviderTarget } from '~/features/agent-runtime/types'
import { fetchRemoteUpstreamJson } from '~/features/remote-hosts/upstream-fetch'

import { filterVisibleModels, ModelVisibilitySchema } from './model-visibility'
import { ProfileConfigJsonSchema } from './profile-config-schema'

export const AGENT_MODELS_QUERY_KEY = ['agent-models'] as const
const MODEL_INVENTORY_GC_TIME_MS = 1_800_000
const MODEL_INVENTORY_QUERY_OPTIONS = {
  staleTime: Infinity,
  gcTime: MODEL_INVENTORY_GC_TIME_MS,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
} as const

export function agentModelsQueryKey(profileId: string | null) {
  return [...AGENT_MODELS_QUERY_KEY, profileId ?? 'no-profile'] as const
}

export function providerTargetModelsQueryKey(
  target: ProviderTarget | null,
  workspaceId?: string | null,
  hostId?: string | null,
) {
  return [
    ...AGENT_MODELS_QUERY_KEY,
    target ? `provider-target:${target.id}` : 'no-provider-target',
    ...(workspaceId ? [`workspace:${workspaceId}`] : []),
    ...(hostId ? [`host:${hostId}`] : []),
  ] as const
}

interface ProviderTargetModelFetchOptions {
  workspaceId?: string | null
  hostId?: string | null
  refresh?: boolean
}

const EMPTY_INITIAL_PROFILE_IDS: ReadonlyArray<string | null> = []

const AgentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic', 'universal']),
  enabled: z.boolean(),
  configJson: z.string(),
  credentialRef: z.string().nullable(),
  customModels: z.string(),
  iconSlug: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
const ModelDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic', 'universal']),
  capabilities: z
    .object({
      contextWindow: z.number().optional(),
      maxOutput: z.number().optional(),
      inputModalities: z.array(z.string()).optional(),
      outputModalities: z.array(z.string()).optional(),
      reasoning: z.boolean().optional(),
      reasoningEfforts: z.array(z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])).optional(),
      toolCall: z.boolean().optional(),
      temperature: z.boolean().optional(),
      structuredOutput: z.boolean().optional(),
      cost: z
        .object({
          input: z.number().optional(),
          output: z.number().optional(),
          cacheRead: z.number().optional(),
          cacheWrite: z.number().optional(),
        })
        .optional(),
      family: z.string().optional(),
      knowledgeCutoff: z.string().optional(),
      releaseDate: z.string().optional(),
      registryMatch: z.enum(['exact', 'fuzzy', 'manual', 'alias', 'unmatched']).optional(),
      registryModelId: z.string().optional(),
      registryModelLabel: z.string().optional(),
    })
    .default({}),
})
const ModelDescriptorListSchema = z.array(ModelDescriptorSchema).default([])
const ProviderTargetModelSettingsSchema = z.object({
  configJson: z.string(),
})
const ProviderTargetModelsCacheSchema = z.object({
  models: ModelDescriptorListSchema,
  cached: z.boolean(),
  stale: z.boolean(),
  coolingDown: z.boolean(),
  providerLabel: z.string(),
})
const ModelInventoryErrorSchema = z.object({
  message: z.string().min(1),
})
const RUNTIME_OWNED_PROVIDER_TARGET_PREFIX = 'runtime-native:'

type ProviderTargetModelRequestTarget = ProviderTarget & {
  enabled: boolean
  name: string
  providerKind: ProviderKind
  sourceKey?: string | null
}

function describeModelInventoryError(error: Error): string {
  const parsed = ModelInventoryErrorSchema.safeParse(error)
  if (parsed.success) {
    return parsed.data.message
  }

  const fallback = String(error)
  return fallback === '[object Object]' ? '' : fallback
}

function isApiProviderKind(providerKind: ProviderKind): providerKind is ApiProviderKind {
  return providerKind !== 'cli-tool'
}

export function isRuntimeOwnedProviderTarget(
  target: Pick<ProviderTarget, 'id'> & { sourceKey?: string | null },
): boolean {
  return target.id.startsWith(RUNTIME_OWNED_PROVIDER_TARGET_PREFIX)
    || target.sourceKey?.startsWith(RUNTIME_OWNED_PROVIDER_TARGET_PREFIX) === true
}

/** Live-fetch when server inventory is missing/empty or past the soft TTL. */
export function shouldLiveRefreshModelInventory(cache: {
  cached: boolean
  stale: boolean
  coolingDown: boolean
  models: readonly unknown[]
}): boolean {
  return !cache.coolingDown && (!cache.cached || cache.models.length === 0 || cache.stale)
}

const inFlightProviderTargetModelRefreshes = new Map<string, Promise<ModelDescriptor[]>>()

function providerTargetModelRefreshKey(
  target: Pick<ProviderTarget, 'id'>,
  options?: ProviderTargetModelFetchOptions,
): string {
  return [
    target.id,
    options?.workspaceId ?? '',
    options?.hostId ?? '',
  ].join('\0')
}

async function refreshProviderTargetModelsDeduped(
  target: ProviderTargetModelRequestTarget,
  options?: ProviderTargetModelFetchOptions,
): Promise<ModelDescriptor[]> {
  const key = providerTargetModelRefreshKey(target, options)
  const existing = inFlightProviderTargetModelRefreshes.get(key)
  if (existing) {
    return existing
  }

  const pending = refreshProviderTargetModels(target, options).finally(() => {
    inFlightProviderTargetModelRefreshes.delete(key)
  })
  inFlightProviderTargetModelRefreshes.set(key, pending)
  return pending
}

async function fetchCachedVisibleModelsForProfile(
  profile: AgentProfile,
): Promise<ModelDescriptor[]> {
  const config = ProfileConfigJsonSchema.parse(profile.configJson)
  const visibility = ModelVisibilitySchema.parse(config.enabledModels)

  const { data: cache } = await getProvidersByProfileIdModelsCache({
    path: { profileId: profile.id },
    throwOnError: true,
  })
  if (!cache.cached || cache.models.length === 0) {
    return []
  }

  const models = ModelDescriptorListSchema.parse(cache.models) satisfies ModelDescriptor[]
  return filterVisibleModels(models, visibility)
}

async function readProviderTargetModelInventory(
  target: ProviderTarget,
  options?: ProviderTargetModelFetchOptions,
): Promise<{
  visibility: z.infer<typeof ModelVisibilitySchema>
  cache: z.infer<typeof ProviderTargetModelsCacheSchema>
}> {
  const hostId = options?.hostId ?? null
  if (hostId) {
    const [settings, cache] = await Promise.all([
      fetchRemoteUpstreamJson<{ configJson: string }>(
        hostId,
        `/provider-targets/${encodeURIComponent(target.id)}/model-settings`,
      ),
      fetchRemoteUpstreamJson<z.infer<typeof ProviderTargetModelsCacheSchema>>(
        hostId,
        `/providers/targets/${encodeURIComponent(target.id)}/models-cache`,
      ),
    ])
    const parsedSettings = ProviderTargetModelSettingsSchema.parse(settings)
    const config = ProfileConfigJsonSchema.parse(parsedSettings.configJson)
    return {
      visibility: ModelVisibilitySchema.parse(config.enabledModels),
      cache: ProviderTargetModelsCacheSchema.parse(cache),
    }
  }

  const [settingsResult, cacheResult] = await Promise.all([
    getProviderTargetsByProviderTargetIdModelSettings({
      path: { providerTargetId: target.id },
      throwOnError: true,
    }),
    getProvidersTargetsByProviderTargetIdModelsCache({
      path: { providerTargetId: target.id },
      throwOnError: true,
    }),
  ])
  const settings = ProviderTargetModelSettingsSchema.parse(settingsResult.data)
  const config = ProfileConfigJsonSchema.parse(settings.configJson)
  return {
    visibility: ModelVisibilitySchema.parse(config.enabledModels),
    cache: ProviderTargetModelsCacheSchema.parse(cacheResult.data),
  }
}

async function refreshProviderTargetModels(
  target: ProviderTargetModelRequestTarget,
  options?: ProviderTargetModelFetchOptions,
): Promise<ModelDescriptor[]> {
  const body = {
    providerKind: isApiProviderKind(target.providerKind) ? target.providerKind : 'universal',
    label: target.name || target.id,
    config: {},
    secretRef: null,
    profileId: null,
    providerTargetKind: target.kind ?? null,
    providerTargetId: target.id,
    workspaceId: options?.workspaceId ?? null,
  }
  const hostId = options?.hostId ?? null
  if (hostId) {
    const data = await fetchRemoteUpstreamJson<unknown>(hostId, '/providers/models', {
      method: 'POST',
      body,
    })
    return ModelDescriptorListSchema.parse(data) satisfies ModelDescriptor[]
  }

  const { data } = await postProvidersModels({
    body,
    throwOnError: true,
  })
  return ModelDescriptorListSchema.parse(data) satisfies ModelDescriptor[]
}

/**
 * Shared inventory read policy for full provider-target records:
 * - `refresh: true` always live-fetches (even when cache is warm)
 * - cache hit with models → return filtered cache immediately (including stale)
 * - cache miss / empty → live-fetch for enabled API provider kinds
 *
 * Stale soft-TTL refresh is owned by `useProviderTargetModelMap` so the UI can
 * paint cached models first, then replace them when a background live fetch finishes.
 */
async function fetchVisibleModelsForProviderTarget(
  target: ProviderTargetModelRequestTarget,
  options?: ProviderTargetModelFetchOptions,
): Promise<ModelDescriptor[]> {
  const { visibility, cache } = await readProviderTargetModelInventory(target, options)
  const canLiveFetch = Boolean(target.enabled && isApiProviderKind(target.providerKind))

  if (options?.refresh) {
    if (!canLiveFetch) {
      if (cache.cached) {
        return filterVisibleModels(ModelDescriptorListSchema.parse(cache.models), visibility)
      }
      return []
    }
    const liveModels = await refreshProviderTargetModelsDeduped(target, options)
    return filterVisibleModels(liveModels, visibility)
  }

  if (cache.coolingDown) {
    return cache.cached
      ? filterVisibleModels(ModelDescriptorListSchema.parse(cache.models), visibility)
      : []
  }

  if (cache.cached && cache.models.length > 0) {
    return filterVisibleModels(ModelDescriptorListSchema.parse(cache.models), visibility)
  }

  if (!canLiveFetch) {
    return []
  }

  const liveModels = await refreshProviderTargetModelsDeduped(target, options)
  return filterVisibleModels(liveModels, visibility)
}

/**
 * Cache-first inventory for id-only provider targets (e.g. session binding).
 * Does not invent providerKind for live fetch — callers with full target metadata
 * should use fetchVisibleModelsForProviderTarget via useProviderTargetModelMap.
 */
async function fetchCachedVisibleModelsForProviderTarget(
  target: ProviderTarget,
  options?: ProviderTargetModelFetchOptions,
): Promise<ModelDescriptor[]> {
  const { visibility, cache } = await readProviderTargetModelInventory(target, options)
  if (!cache.cached || cache.models.length === 0) {
    return []
  }
  return filterVisibleModels(ModelDescriptorListSchema.parse(cache.models), visibility)
}

export function useAgentModels(profileId: string | null) {
  const { data: models = [], isLoading } = useQuery({
    queryKey: agentModelsQueryKey(profileId),
    enabled: profileId !== null,
    queryFn: async (): Promise<ModelDescriptor[]> => {
      if (!profileId) {
        return []
      }
      const { data: profileData } = await getProfilesById({ path: { id: profileId } })
      const profile = AgentProfileSchema.parse(profileData) satisfies AgentProfile
      return fetchCachedVisibleModelsForProfile(profile)
    },
    ...MODEL_INVENTORY_QUERY_OPTIONS,
  })

  return { models, isLoading }
}

export function useProviderTargetModels(
  target: ProviderTarget | null,
  options: { workspaceId?: string | null, hostId?: string | null } = {},
) {
  const { data: models = [], isLoading } = useQuery({
    queryKey: providerTargetModelsQueryKey(target, options.workspaceId, options.hostId),
    enabled: target !== null,
    queryFn: async (): Promise<ModelDescriptor[]> => {
      if (!target) {
        return []
      }
      return fetchCachedVisibleModelsForProviderTarget(target, options)
    },
    ...MODEL_INVENTORY_QUERY_OPTIONS,
  })

  return { models, isLoading }
}

export function useAgentModelMap(
  profiles: AgentProfile[],
  initialProfileIds: ReadonlyArray<string | null> = EMPTY_INITIAL_PROFILE_IDS,
) {
  const [requestedProfileIds, setRequestedProfileIds] = useState<Set<string>>(
    () => new Set(initialProfileIds.flatMap(profileId => (profileId ? [profileId] : []))),
  )

  useEffect(() => {
    setRequestedProfileIds((current) => {
      let changed = false
      const next = new Set(current)
      for (const profileId of initialProfileIds) {
        if (profileId && !next.has(profileId)) {
          next.add(profileId)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [initialProfileIds])

  const requestedProfiles = useMemo(
    () => profiles.filter(profile => requestedProfileIds.has(profile.id)),
    [profiles, requestedProfileIds],
  )

  const queries = useQueries({
    queries: requestedProfiles.map(profile => ({
      queryKey: agentModelsQueryKey(profile.id),
      queryFn: () => fetchCachedVisibleModelsForProfile(profile),
      enabled: profile.enabled,
      ...MODEL_INVENTORY_QUERY_OPTIONS,
    })),
  })

  const requestProfileModels = useCallback((profileId: string) => {
    setRequestedProfileIds((current) => {
      if (current.has(profileId)) {
        return current
      }
      const next = new Set(current)
      next.add(profileId)
      return next
    })
  }, [])

  const modelsByProfileId: Record<string, ModelDescriptor[]> = {}
  const loadingProfileIds = new Set<string>()
  const successfulProfileIds = new Set<string>()

  requestedProfiles.forEach((profile, index) => {
    const query = queries[index]
    modelsByProfileId[profile.id] = ModelDescriptorListSchema.parse(
      query?.data,
    ) satisfies ModelDescriptor[]
    if (query?.isLoading || query?.isFetching) {
      loadingProfileIds.add(profile.id)
    }
    if (query?.isSuccess) {
      successfulProfileIds.add(profile.id)
    }
  })

  return {
    modelsByProfileId,
    loadingProfileIds,
    successfulProfileIds,
    requestProfileModels,
  }
}

export function useProviderTargetModelMap(
  providerTargets: ProviderTargetModelRequestTarget[],
  initialProviderTargetIds: ReadonlyArray<string | null> = EMPTY_INITIAL_PROFILE_IDS,
  hookOptions: { workspaceId?: string | null, hostId?: string | null } = {},
) {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const refreshesRef = useRef(new Map<string, Promise<ModelDescriptor[]>>())
  const reportedErrorsRef = useRef(new Map<string, number>())
  const [requestedProviderTargetIds, setRequestedProviderTargetIds] = useState<Set<string>>(
    () => new Set(initialProviderTargetIds.flatMap(targetId => (targetId ? [targetId] : []))),
  )
  const requestedProviderTargetIdsRef = useRef(new Set(initialProviderTargetIds.flatMap(targetId => (targetId ? [targetId] : []))))

  useEffect(() => {
    const next = new Set(requestedProviderTargetIdsRef.current)
    for (const targetId of initialProviderTargetIds) {
      if (targetId) {
        next.add(targetId)
      }
    }
    if (next.size === requestedProviderTargetIdsRef.current.size) {
      return
    }
    requestedProviderTargetIdsRef.current = next
    setRequestedProviderTargetIds(next)
  }, [initialProviderTargetIds])

  const requestedTargets = useMemo(
    () => providerTargets.filter(target => requestedProviderTargetIds.has(target.id)),
    [providerTargets, requestedProviderTargetIds],
  )

  const queries = useQueries({
    queries: requestedTargets.map(target => ({
      queryKey: providerTargetModelsQueryKey(target, hookOptions.workspaceId, hookOptions.hostId),
      queryFn: () => fetchVisibleModelsForProviderTarget(target, {
        workspaceId: hookOptions.workspaceId,
        hostId: hookOptions.hostId,
      }),
      enabled: target.enabled,
      ...MODEL_INVENTORY_QUERY_OPTIONS,
    })),
  })

  useEffect(() => {
    requestedTargets.forEach((target, index) => {
      const query = queries[index]
      if (!query?.isError || !query.error || query.errorUpdatedAt === 0) {
        return
      }

      const reportedAt = reportedErrorsRef.current.get(target.id)
      if (reportedAt === query.errorUpdatedAt) {
        return
      }

      reportedErrorsRef.current.set(target.id, query.errorUpdatedAt)
      toastManager.add({
        type: 'error',
        title: t('model.loadFailed'),
        description: t('model.loadFailedDescription', {
          provider: target.name,
          message: describeModelInventoryError(query.error) || t('status.error'),
        }),
      })
    })
  }, [queries, requestedTargets, t])

  const liveRefreshProviderTargetModels = useCallback((target: ProviderTargetModelRequestTarget) => {
    if (!target.enabled || !isApiProviderKind(target.providerKind)) {
      return
    }

    const existingRefresh = refreshesRef.current.get(target.id)
    if (existingRefresh) {
      return
    }

    const queryKey = providerTargetModelsQueryKey(target, hookOptions.workspaceId, hookOptions.hostId)
    const refresh = (async () => {
      await queryClient.cancelQueries({ queryKey })
      return queryClient.fetchQuery({
        queryKey,
        queryFn: () => fetchVisibleModelsForProviderTarget(target, {
          refresh: true,
          workspaceId: hookOptions.workspaceId,
          hostId: hookOptions.hostId,
        }),
        staleTime: 0,
        gcTime: MODEL_INVENTORY_GC_TIME_MS,
        retry: false,
      })
    })()
    refreshesRef.current.set(target.id, refresh)
    void refresh.catch(() => []).finally(() => {
      refreshesRef.current.delete(target.id)
    })
  }, [hookOptions.hostId, hookOptions.workspaceId, queryClient])

  const ensureProviderTargetModelsFresh = useCallback((target: ProviderTargetModelRequestTarget) => {
    if (!target.enabled || !isApiProviderKind(target.providerKind)) {
      return
    }
    // Runtime-owned targets (currently OpenCode) are projected at runtime and
    // have no durable provider_target_model_cache row. Their initial query
    // already fetched the live catalog; treating that permanent cache miss as
    // a background-refresh signal creates an endless fetch → query update loop.
    if (isRuntimeOwnedProviderTarget(target)) {
      return
    }
    if (refreshesRef.current.has(target.id)) {
      return
    }

    void (async () => {
      try {
        const { cache } = await readProviderTargetModelInventory(target, {
          workspaceId: hookOptions.workspaceId,
          hostId: hookOptions.hostId,
        })
        if (!shouldLiveRefreshModelInventory(cache)) {
          return
        }
        liveRefreshProviderTargetModels(target)
      }
      catch {
        // Leave queryFn / explicit refresh to surface inventory errors.
      }
    })()
  }, [hookOptions.hostId, hookOptions.workspaceId, liveRefreshProviderTargetModels])

  const inventorySyncKey = requestedTargets
    .map((target, index) => {
      const query = queries[index]
      return `${target.id}:${query?.status ?? 'idle'}:${query?.dataUpdatedAt ?? 0}`
    })
    .join('|')

  const requestedTargetsRef = useRef(requestedTargets)
  const queriesRef = useRef(queries)
  requestedTargetsRef.current = requestedTargets
  queriesRef.current = queries

  // After cache-first paint, soft-refresh only when server cache is missing or stale.
  useEffect(() => {
    requestedTargetsRef.current.forEach((target, index) => {
      if (!queriesRef.current[index]?.isSuccess) {
        return
      }
      ensureProviderTargetModelsFresh(target)
    })
  }, [ensureProviderTargetModelsFresh, inventorySyncKey])

  const requestProviderTargetModels = useCallback((targetId: string, options?: { refresh?: boolean }) => {
    const target = providerTargets.find(candidate => candidate.id === targetId)
    if (!target?.enabled) {
      return
    }

    const alreadyRequested = requestedProviderTargetIdsRef.current.has(targetId)
    if (!alreadyRequested) {
      const next = new Set(requestedProviderTargetIdsRef.current)
      next.add(targetId)
      requestedProviderTargetIdsRef.current = next
      setRequestedProviderTargetIds(next)
    }

    if (options?.refresh) {
      liveRefreshProviderTargetModels(target)
    }

    // A mounted query owns the initial cache read and any automatic refresh.
    // Menu open, focus, hover, and a previously failed query must never retry
    // the provider implicitly. Only an explicit { refresh: true } may do that.
  }, [liveRefreshProviderTargetModels, providerTargets])

  const modelsByProviderTargetId: Record<string, ModelDescriptor[]> = {}
  const loadingProviderTargetIds = new Set<string>()
  const successfulProviderTargetIds = new Set<string>()

  requestedTargets.forEach((target, index) => {
    const query = queries[index]
    modelsByProviderTargetId[target.id] = ModelDescriptorListSchema.parse(
      query?.data,
    ) satisfies ModelDescriptor[]
    if (query?.isLoading || query?.isFetching) {
      loadingProviderTargetIds.add(target.id)
    }
    if (query?.isSuccess) {
      successfulProviderTargetIds.add(target.id)
    }
  })

  return {
    modelsByProviderTargetId,
    loadingProviderTargetIds,
    successfulProviderTargetIds,
    requestProviderTargetModels,
  }
}
