import * as ModelRegistry from '../model-registry/service'
import type { ModelDescriptor } from '../provider-contracts/types'
import type { ProviderTarget, ProviderTargetModelVisibility, ResolvedProviderTarget } from '../provider-targets/service'
import {
  readProviderTargetModelVisibility,
  resolveProviderTarget,
} from '../provider-targets/service'
import {
  getCachedModelRefreshFailure,
  isCacheStale,
  readCachedModelInventory,
  setCachedModelRefreshFailure,
  setCachedModelsForTarget,
} from './model-cache'
import { projectProviderModelListCapabilities } from './model-capabilities'
import { collectProviderModelInventory, providerRequestForResolvedTarget } from './service'

/**
 * Explicit freshness policy for target-scoped model queries. Network access is
 * decided solely by this mode — never by timeouts or heuristics.
 *
 * - `cached`: read persisted inventory only; never contacts the upstream.
 * - `prefer-cache`: serve a fresh cache when present; a cold or stale cache
 *   triggers exactly one inventory fetch governed by the failed-refresh
 *   cooldown (during cooldown the stale cache — or an empty result on a cold
 *   cache — is served instead of fetching).
 * - `refresh`: unconditional live inventory fetch; explicit refreshes bypass
 *   the failed-refresh cooldown.
 */
export type ProviderTargetModelFreshness = 'cached' | 'prefer-cache' | 'refresh'

/**
 * Visibility projection applied to query results.
 * - `all`: every collected model.
 * - `stored`: the target's persisted enabled-model list, owned by Provider
 *   Targets. An all-disabled target short-circuits to an empty result without
 *   fetching.
 */
export type ProviderTargetModelVisibilityMode = 'all' | 'stored'

export interface QueryProviderTargetModelsInput {
  target: ProviderTarget | string
  freshness?: ProviderTargetModelFreshness
  visibility?: ProviderTargetModelVisibilityMode
  workspaceId?: string | null
}

export interface ProviderTargetModelsResult {
  models: ModelDescriptor[]
  providerLabel: string
  /** Whether `models` were served from previously persisted cache. */
  cached: boolean
  /** Unix seconds timestamp of the persisted inventory row, if any. */
  fetchedAt: number | null
  /** Whether the served cache row is past the soft freshness TTL. */
  stale: boolean
  /** Whether the failed-refresh cooldown is currently suppressing fetches. */
  coolingDown: boolean
}

function applyModelVisibility(
  models: ModelDescriptor[],
  visibility: ProviderTargetModelVisibility,
): ModelDescriptor[] {
  switch (visibility.kind) {
    case 'all':
      return models
    case 'all-disabled':
      return []
    case 'subset': {
      const allowed = new Set(visibility.modelIds)
      return models.filter(model => allowed.has(model.id))
    }
  }
}

/**
 * Fetch live inventory for a resolved target through the shared collection
 * pipeline (runtime-owned inventory, custom-model merge, default-model
 * fallback, audit write), persist the inventory-only result, and maintain the
 * failed-refresh cooldown marker.
 */
async function fetchAndCacheTargetInventory(
  resolved: ResolvedProviderTarget,
  workspaceId: string | null | undefined,
): Promise<ModelDescriptor[]> {
  try {
    const inventory = await collectProviderModelInventory({
      ...providerRequestForResolvedTarget(resolved),
      workspaceId,
    })
    setCachedModelsForTarget(resolved.target, inventory)
    return inventory
  }
  catch (error) {
    setCachedModelRefreshFailure(resolved.target)
    throw error
  }
}

/**
 * Target-scoped model query: the single seam every consumer (HTTP routes,
 * Conversation Bridge, future callers) uses for provider model lists.
 *
 * Fixed pipeline: resolve target → short-circuit stored all-disabled
 * visibility → select cache/fetch per explicit freshness mode → collect
 * inventory with custom/default fallback → persist inventory-only cache →
 * Model Registry enrichment → provider capability projection → apply
 * visibility → return models + freshness metadata.
 *
 * @throws AppError `provider_target_not_found` when the target does not resolve.
 * @throws the mapped provider/fallback error when a required fetch fails with
 *         no fallback and no stale cache to serve.
 */
export async function queryProviderTargetModels(
  input: QueryProviderTargetModelsInput,
): Promise<ProviderTargetModelsResult> {
  const resolved = resolveProviderTarget(input.target)
  const freshness = input.freshness ?? 'prefer-cache'
  const visibility = input.visibility === 'stored'
    ? readProviderTargetModelVisibility(resolved.enabledModelsJson)
    : { kind: 'all' as const }
  const failure = getCachedModelRefreshFailure(resolved.target)

  // All-disabled visibility never justifies a fetch.
  if (visibility.kind === 'all-disabled') {
    return {
      models: [],
      providerLabel: resolved.label,
      cached: false,
      fetchedAt: null,
      stale: false,
      coolingDown: failure !== null,
    }
  }

  const project = async (inventory: ModelDescriptor[]): Promise<ModelDescriptor[]> =>
    applyModelVisibility(
      projectProviderModelListCapabilities(await ModelRegistry.enrichModels(inventory)),
      visibility,
    )

  const serveCache = async (cached: NonNullable<ReturnType<typeof readCachedModelInventory>>): Promise<ProviderTargetModelsResult> => ({
    models: await project(cached.models),
    providerLabel: resolved.label,
    cached: true,
    fetchedAt: cached.fetchedAt,
    stale: isCacheStale(cached.fetchedAt),
    coolingDown: getCachedModelRefreshFailure(resolved.target) !== null,
  })

  const serveFetched = async (): Promise<ProviderTargetModelsResult> => {
    const inventory = await fetchAndCacheTargetInventory(resolved, input.workspaceId)
    return {
      models: await project(inventory),
      providerLabel: resolved.label,
      cached: false,
      fetchedAt: readCachedModelInventory(resolved.target)?.fetchedAt ?? null,
      stale: false,
      coolingDown: false,
    }
  }

  if (freshness === 'cached') {
    const cached = readCachedModelInventory(resolved.target)
    if (cached) {
      return await serveCache(cached)
    }
    return {
      models: [],
      providerLabel: resolved.label,
      cached: false,
      fetchedAt: null,
      stale: false,
      coolingDown: failure !== null,
    }
  }

  if (freshness === 'refresh') {
    return await serveFetched()
  }

  // prefer-cache: fresh cache wins; cold/stale triggers one cooldown-governed fetch.
  const cached = readCachedModelInventory(resolved.target)
  if (cached && !isCacheStale(cached.fetchedAt)) {
    return await serveCache(cached)
  }
  if (failure) {
    return cached
      ? await serveCache(cached)
      : {
          models: [],
          providerLabel: resolved.label,
          cached: false,
          fetchedAt: null,
          stale: false,
          coolingDown: true,
        }
  }
  try {
    return await serveFetched()
  }
  catch (error) {
    if (cached) {
      // A failed refresh must not lose the stale inventory we already hold.
      return await serveCache(cached)
    }
    throw error
  }
}
