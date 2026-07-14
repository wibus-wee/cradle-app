import { providerTargetModelCache } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../infra'
import { enrichModelsFromRegistryMappings } from '../model-registry/model-info-registry'
import * as ModelRegistry from '../model-registry/service'
import type { ModelCapabilities, ModelDescriptor } from '../provider-contracts/types'
import type { ProviderTarget } from '../provider-targets/service'
import { providerTargetCacheId } from '../provider-targets/service'
import { projectProviderModelListCapabilities } from './model-capabilities'

const STALE_THRESHOLD_S = 60 * 60 // 1 hour soft TTL — clients may background-refresh when stale
const FAILED_REFRESH_COOLDOWN_S = 2 * 60

// A failed upstream inventory probe is transient operational state, not inventory.
// Keep it in-process so a broken provider cannot be retried on every menu event,
// without persisting an obsolete outage across an app restart.
const failedModelRefreshRetryAfterByTargetId = new Map<string, number>()

export interface CachedModelsResult {
  models: ModelDescriptor[]
  fetchedAt: number
  cached: boolean
}

export interface CachedModelRefreshFailure {
  retryAfter: number
}

const ModelCapabilitiesSchema = z.object({
  contextWindow: z.number().finite().optional(),
  maxOutput: z.number().finite().optional(),
  inputModalities: z.array(z.string()).optional(),
  outputModalities: z.array(z.string()).optional(),
  reasoning: z.boolean().optional(),
  reasoningEfforts: z.array(z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])).optional(),
  toolCall: z.boolean().optional(),
  temperature: z.boolean().optional(),
  structuredOutput: z.boolean().optional(),
  cost: z.object({
    input: z.number().finite().optional(),
    output: z.number().finite().optional(),
    cacheRead: z.number().finite().optional(),
    cacheWrite: z.number().finite().optional(),
  }).optional(),
  family: z.string().optional(),
  knowledgeCutoff: z.string().optional(),
  releaseDate: z.string().optional(),
  registryMatch: z.enum(['exact', 'fuzzy', 'manual', 'alias', 'unmatched']).optional(),
  registryModelId: z.string().optional(),
  registryModelLabel: z.string().optional(),
})

const ModelDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic', 'universal']),
  capabilities: ModelCapabilitiesSchema,
})

const CachedModelsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(ModelDescriptorSchema))

/**
 * Strip all registry-enrichment-derived fields from a model descriptor so only
 * upstream inventory data is persisted. Registry fields are re-applied on read.
 */
function toInventoryModel(model: ModelDescriptor): ModelDescriptor {
  const {
    registryMatch: _rm,
    registryModelId: _rmi,
    registryModelLabel: _rml,
    cost: _c,
    family: _f,
    knowledgeCutoff: _kc,
    releaseDate: _rd,
    ...inventoryCaps
  }: ModelCapabilities = model.capabilities
  return {
    id: model.id,
    label: model.label,
    providerKind: model.providerKind,
    capabilities: inventoryCaps,
  }
}

/**
 * Load cached inventory from DB, apply current registry enrichment and provider
 * capability defaults, and return the projected result. Re-enriching on every
 * cache read ensures mapping changes take effect without a cache invalidation.
 */
export async function getCachedModelsForTarget(target: ProviderTarget): Promise<CachedModelsResult | null> {
  const row = db()
    .select()
    .from(providerTargetModelCache)
    .where(eq(providerTargetModelCache.providerTargetId, providerTargetCacheId(target)))
    .get()
  if (!row) {
    return null
  }
  const inventory = CachedModelsJsonSchema.parse(row.modelsJson)
  const enriched = await enrichModelsFromRegistryMappings(inventory, ModelRegistry.listMappingEntries())
  const models = projectProviderModelListCapabilities(enriched)
  return { models, fetchedAt: row.fetchedAt, cached: true }
}

/**
 * Persist inventory-only models for a provider target. Registry-enrichment-derived
 * fields (registryMatch, registryModelId, cost, family, etc.) are stripped before
 * storage so the cache stays pure and enrichment always reflects current mappings
 * on the next read.
 */
export function setCachedModelsForTarget(target: ProviderTarget, models: ModelDescriptor[]): void {
  const now = Math.floor(Date.now() / 1000)
  const inventoryModels = models.map(toInventoryModel)
  try {
    db().insert(providerTargetModelCache).values({
      providerTargetId: providerTargetCacheId(target),
      modelsJson: JSON.stringify(inventoryModels),
      fetchedAt: now,
    }).onConflictDoUpdate({
      target: providerTargetModelCache.providerTargetId,
      set: {
        modelsJson: JSON.stringify(inventoryModels),
        fetchedAt: now,
      },
    }).run()
    clearCachedModelRefreshFailure(target)
  }
  catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return
    }
    throw err
  }
}

/**
 * Suppress automatic live retries for a short period after an upstream inventory
 * request fails. Explicit refreshes still bypass this cooldown.
 */
export function setCachedModelRefreshFailure(target: ProviderTarget): void {
  failedModelRefreshRetryAfterByTargetId.set(
    providerTargetCacheId(target),
    Math.floor(Date.now() / 1000) + FAILED_REFRESH_COOLDOWN_S,
  )
}

export function getCachedModelRefreshFailure(target: ProviderTarget): CachedModelRefreshFailure | null {
  const targetId = providerTargetCacheId(target)
  const retryAfter = failedModelRefreshRetryAfterByTargetId.get(targetId)
  if (!retryAfter) {
    return null
  }
  if (retryAfter <= Math.floor(Date.now() / 1000)) {
    failedModelRefreshRetryAfterByTargetId.delete(targetId)
    return null
  }
  return { retryAfter }
}

export function clearCachedModelRefreshFailure(target: ProviderTarget): void {
  failedModelRefreshRetryAfterByTargetId.delete(providerTargetCacheId(target))
}

export function deleteCachedModelsForTarget(target: ProviderTarget): void {
  db().delete(providerTargetModelCache).where(eq(providerTargetModelCache.providerTargetId, providerTargetCacheId(target))).run()
}

export function isCacheStale(fetchedAt: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return (now - fetchedAt) > STALE_THRESHOLD_S
}
