import type { QueryClient } from '@tanstack/react-query'
import { queryOptions, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import {
  getProfilesById,
  getProvidersByProfileIdModelsCache,
  getProvidersTargetsByProviderTargetIdModelsCache,
  getProviderTargets,
  getProviderTargetsByProviderTargetIdModelSettings,
  postProvidersModels,
} from '~/api-gen/sdk.gen'
import type { GetProviderTargetsResponse } from '~/api-gen/types.gen'
import { toastManager } from '~/components/ui/toast'
import type { AgentProfile, ApiProviderKind, ModelDescriptor, ProviderKind, ProviderTarget } from '~/features/agent-runtime/types'
import { fetchNodeUpstreamJson } from '~/features/nodes/upstream-fetch'

import { filterVisibleModels, ModelVisibilitySchema } from './model-visibility'
import { ProfileConfigJsonSchema } from './profile-config-schema'

export const AGENT_MODELS_QUERY_KEY = ['agent-models'] as const
const MODEL_INVENTORY_GC_TIME_MS = 1_800_000
const MODEL_INVENTORY_QUERY_OPTIONS = {
  staleTime: 60_000,
  gcTime: MODEL_INVENTORY_GC_TIME_MS,
  refetchOnMount: true,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
  retry: false,
} as const

export function agentModelsQueryKey(profileId: string | null) {
  return [...AGENT_MODELS_QUERY_KEY, profileId ?? 'no-profile'] as const
}

export function providerTargetModelsQueryKey(
  target: (ProviderTarget & { sourceKey?: string | null }) | null,
  workspaceId?: string | null,
  nodeId?: string | null,
) {
  return [
    ...AGENT_MODELS_QUERY_KEY,
    target ? `provider-target:${target.id}` : 'no-provider-target',
    ...(nodeId ? [`host:${nodeId}`] : []),
    ...(workspaceId && (nodeId || isRuntimeOwnedProviderTarget(target ?? { id: '' }))
      ? [`workspace:${workspaceId}`]
      : []),
  ] as const
}

interface ProviderTargetModelFetchOptions {
  workspaceId?: string | null
  nodeId?: string | null
  refresh?: boolean
  signal?: AbortSignal
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
  providerId: z.string().nullable(),
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
      reasoningEfforts: z.array(z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])).optional(),
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
  enabledModelsJson?: string
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

/** The server owns inventory freshness; a fresh empty catalog is valid. */
export function shouldLiveRefreshModelInventory(cache: {
  cached: boolean
  stale: boolean
  coolingDown: boolean
  models: readonly unknown[]
}): boolean {
  return !cache.coolingDown && (!cache.cached || cache.stale)
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
  const nodeId = options?.nodeId ?? null

  const cachePromise = nodeId
    ? fetchNodeUpstreamJson<z.infer<typeof ProviderTargetModelsCacheSchema>>(
        nodeId,
        `/providers/targets/${encodeURIComponent(target.id)}/models-cache`,
        { signal: options?.signal },
      )
    : getProvidersTargetsByProviderTargetIdModelsCache({
        path: { providerTargetId: target.id },
        signal: options?.signal,
        throwOnError: true,
      }).then(result => result.data)

  if (nodeId) {
    const [settings, cache] = await Promise.all([
      fetchNodeUpstreamJson<{ configJson: string }>(
        nodeId,
        `/provider-targets/${encodeURIComponent(target.id)}/model-settings`,
        { signal: options?.signal },
      ),
      cachePromise,
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
      signal: options?.signal,
      throwOnError: true,
    }),
    cachePromise.then(data => ({ data })),
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
  const nodeId = options?.nodeId ?? null
  if (nodeId) {
    const data = await fetchNodeUpstreamJson<unknown>(nodeId, '/providers/models', {
      method: 'POST',
      body,
      signal: options?.signal,
    })
    return ModelDescriptorListSchema.parse(data) satisfies ModelDescriptor[]
  }

  const { data } = await postProvidersModels({
    body,
    signal: options?.signal,
    throwOnError: true,
  })
  return ModelDescriptorListSchema.parse(data) satisfies ModelDescriptor[]
}

function providerTargetModelQueryOptions(
  queryClient: QueryClient,
  target: ProviderTarget | ProviderTargetModelRequestTarget,
  options: ProviderTargetModelFetchOptions = {},
) {
  const queryKey = providerTargetModelsQueryKey(target, options.workspaceId, options.nodeId)
  return queryOptions({
    queryKey,
    ...MODEL_INVENTORY_QUERY_OPTIONS,
    queryFn: async ({ signal }): Promise<ModelDescriptor[]> => {
      const fetchOptions = { ...options, signal }
      const { visibility, cache } = await readProviderTargetModelInventory(target, fetchOptions)
      signal.throwIfAborted()
      const cachedModels = filterVisibleModels(
        cache.cached ? cache.models : queryClient.getQueryData<ModelDescriptor[]>(queryKey) ?? [],
        visibility,
      )
      if (!options.refresh && !shouldLiveRefreshModelInventory(cache)) {
        return cachedModels
      }

      // Publish cached inventory while the same cancellable query owns the live request.
      if (!options.refresh) {
        queryClient.setQueryData(queryKey, cachedModels)
      }
      try {
        // Session bindings carry only an ID but must use the same query policy as pickers.
        let requestTarget: ProviderTargetModelRequestTarget
        if ('providerKind' in target) {
          requestTarget = target
        }
        else {
          const targets = options.nodeId
            ? await fetchNodeUpstreamJson<GetProviderTargetsResponse>(
                options.nodeId,
                `/provider-targets${options.workspaceId ? `?workspaceId=${encodeURIComponent(options.workspaceId)}` : ''}`,
                { signal },
              )
            : (await getProviderTargets({
                query: { workspaceId: options.workspaceId ?? undefined },
                signal,
                throwOnError: true,
              })).data
          const resolved = targets.find(candidate => candidate.id === target.id)
          if (!resolved) {
            return cachedModels
          }
          requestTarget = { ...resolved, name: resolved.displayName }
        }
        if (!requestTarget.enabled || !isApiProviderKind(requestTarget.providerKind)) {
          return cachedModels
        }
        const models = await refreshProviderTargetModels(requestTarget, fetchOptions)
        signal.throwIfAborted()
        return filterVisibleModels(models, visibility)
      }
      catch (error) {
        signal.throwIfAborted()
        if (options.refresh) {
          throw error
        }
        return cachedModels
      }
    },
  })
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
  options: { workspaceId?: string | null, nodeId?: string | null } = {},
) {
  const queryClient = useQueryClient()
  const { data: models = [], isLoading } = useQuery({
    ...providerTargetModelQueryOptions(queryClient, target ?? { id: '' }, options),
    queryKey: providerTargetModelsQueryKey(target, options.workspaceId, options.nodeId),
    enabled: target !== null,
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
  hookOptions: { workspaceId?: string | null, nodeId?: string | null } = {},
) {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
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
      ...providerTargetModelQueryOptions(queryClient, target, hookOptions),
      enabled: target.enabled,
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

    const query = providerTargetModelQueryOptions(queryClient, target, {
      workspaceId: hookOptions.workspaceId,
      nodeId: hookOptions.nodeId,
      ...options,
    })
    const state = queryClient.getQueryState(query.queryKey)
    if (!options?.refresh && state?.status === 'error') {
      return
    }
    // fetchQuery deduplicates concurrent consumers and only revalidates stale data.
    void queryClient.fetchQuery({
      ...query,
      ...(options?.refresh ? { staleTime: 0 } : {}),
    }).catch(() => {
      // The query observer reports explicit refresh and cache-read failures.
    })
  }, [hookOptions.nodeId, hookOptions.workspaceId, providerTargets, queryClient])

  const modelsByProviderTargetId: Record<string, ModelDescriptor[]> = {}
  const loadingProviderTargetIds = new Set<string>()
  const successfulProviderTargetIds = new Set<string>()

  requestedTargets.forEach((target, index) => {
    const query = queries[index]
    modelsByProviderTargetId[target.id] = ModelDescriptorListSchema.parse(
      query?.data,
    ) satisfies ModelDescriptor[]
    const hasModels = (query?.data?.length ?? 0) > 0
    if (query?.isLoading || (query?.isFetching && !hasModels)) {
      loadingProviderTargetIds.add(target.id)
    }
    if (query?.isSuccess && (!query.isFetching || hasModels)) {
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
