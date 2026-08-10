import { kvCache, modelRegistryMappings } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db, registerBeforeDatabaseShutdown } from '../../infra'
import type { ModelCapabilities, ModelDescriptor } from '../provider-contracts/types'
import { aggregateModelsDevRecords } from './model-info-aggregation'

export type ModelsDevReasoningOption = {
  type?: string
  values?: Array<string | null>
  min?: number
  max?: number
}

export interface ModelsDevModel {
  id: string
  name?: string
  limit?: { context?: number, output?: number }
  modalities?: { input?: string[], output?: string[] }
  reasoning?: boolean
  /** Per-model reasoning controls from models.dev (`effort` / `toggle` / `budget_tokens`). */
  reasoning_options?: ModelsDevReasoningOption[]
  tool_call?: boolean
  temperature?: boolean
  structured_output?: boolean
  cost?: { input?: number, output?: number, cache_read?: number, cache_write?: number }
  family?: string
  knowledge?: string
  release_date?: string
}

type ReasoningEffort = NonNullable<ModelCapabilities['reasoningEfforts']>[number]

const KNOWN_REASONING_EFFORTS = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
])

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && KNOWN_REASONING_EFFORTS.has(value as ReasoningEffort)
}

/**
 * Project models.dev `reasoning_options` into Cradle `reasoningEfforts`.
 * - `effort.values` → discrete efforts supported by Cradle (unknown values dropped)
 * - empty options / toggle / budget_tokens-only → `[]` (reasoning supported, no effort slider)
 * - `reasoning: false` → no efforts field
 */
function readModelsDevReasoningEfforts(model: ModelsDevModel): ReasoningEffort[] | undefined {
  if (model.reasoning === false) {
    return undefined
  }

  if (!Array.isArray(model.reasoning_options)) {
    // reasoning:true without options → declare empty (do not invent a ladder)
    return model.reasoning === true ? [] : undefined
  }

  const efforts: ReasoningEffort[] = []
  const seen = new Set<ReasoningEffort>()
  for (const option of model.reasoning_options) {
    if (option?.type !== 'effort' || !Array.isArray(option.values)) {
      continue
    }
    for (const value of option.values) {
      if (!isReasoningEffort(value) || seen.has(value)) {
        continue
      }
      seen.add(value)
      efforts.push(value)
    }
  }

  // reasoning:true (or effort values present) → always declare the list, even when empty
  if (model.reasoning === true || efforts.length > 0) {
    return efforts
  }
  return undefined
}

export interface ModelRegistryMappingEntry {
  modelId: string
  registryModelId?: string
  matchType?: 'manual' | 'alias'
  model?: ModelsDevModel
  updatedAt?: number
}

export interface ModelRegistrySearchResult {
  id: string
  label: string
  capabilities: ModelCapabilities
}

export interface ModelsDevProvider {
  name?: string
  /** OpenAI-compatible base URL advertised by the provider, when any. */
  api?: string
  npm?: string
  /** Required environment variable names, e.g. ['DEEPSEEK_API_KEY']. */
  env?: string[]
  doc?: string
  models: Record<string, ModelsDevModel>
}

export type ModelsDevData = Record<string, ModelsDevProvider>

const MODELS_DEV_URL = 'https://models.dev/api.json'
const CACHE_KEY = 'models_dev_api_json'
/** Serve cached data without refresh while younger than this. */
const SOFT_TTL_MS = 1000 * 60 * 60 // 1 hour
/** After this age, block on a network refresh (still fall back to stale on failure). */
const HARD_TTL_MS = 1000 * 60 * 60 * 24 // 24 hours

let memCache: ModelsDevData | null = null
/** Wall-clock ms when the in-memory snapshot was fetched from the network. */
let memFetchedAt = 0
let refreshInFlight: Promise<ModelsDevData | null> | null = null
let cacheGeneration = 0
let dbCacheLoaded = false
let mappingCacheLoaded = false
const mappingCache = new Map<string, ModelRegistryMappingEntry>()
const costCache = new Map<string, ModelsDevCost | null>()
const contextWindowCache = new Map<string, number | null>()
const DATE_SUFFIX_RE = /-\d{8}$/
const VERSION_SUFFIX_RE = /-\d{4}-\d{2}-\d{2}$/
const SEP_RE = /[.\-]+/

export const ModelsDevModelSchema: z.ZodType<ModelsDevModel> = z.object({
  id: z.string(),
  name: z.string().optional(),
  limit: z.object({
    context: z.number().finite().optional(),
    output: z.number().finite().optional(),
  }).optional(),
  modalities: z.object({
    input: z.array(z.string()).optional(),
    output: z.array(z.string()).optional(),
  }).optional(),
  reasoning: z.boolean().optional(),
  reasoning_options: z.array(z.object({
    type: z.string().optional(),
    values: z.array(z.union([z.string(), z.null()])).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  }).passthrough()).optional(),
  tool_call: z.boolean().optional(),
  temperature: z.boolean().optional(),
  structured_output: z.boolean().optional(),
  cost: z.object({
    input: z.number().finite().optional(),
    output: z.number().finite().optional(),
    cache_read: z.number().finite().optional(),
    cache_write: z.number().finite().optional(),
  }).optional(),
  family: z.string().optional(),
  knowledge: z.string().optional(),
  release_date: z.string().optional(),
}).passthrough()

const ModelsDevDataSchema = z.record(z.string(), z.object({
  name: z.string().optional(),
  api: z.string().optional(),
  npm: z.string().optional(),
  env: z.array(z.string()).optional(),
  doc: z.string().optional(),
  models: z.record(z.string(), ModelsDevModelSchema),
}).passthrough())

const ModelsDevDataJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ModelsDevDataSchema)

interface ModelsDevCost {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

registerBeforeDatabaseShutdown(() => {
  cacheGeneration += 1
  refreshInFlight = null
  memCache = null
  memFetchedAt = 0
  dbCacheLoaded = false
  mappingCacheLoaded = false
  mappingCache.clear()
  costCache.clear()
  contextWindowCache.clear()
})

async function fetchFromNetwork(): Promise<ModelsDevData | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(MODELS_DEV_URL, { signal: controller.signal })
    if (!response.ok) {
      return null
    }
    return ModelsDevDataSchema.parse(await response.json())
  }
  finally {
    clearTimeout(timeout)
  }
}

/**
 * Read the DB snapshot. `expiresAt` is the hard-TTL deadline; fetch time is
 * derived as expiresAt - HARD_TTL so we don't need a schema change for SWR.
 * Hard-expired rows are still returned as stale fallbacks.
 */
function readDbCache(): { data: ModelsDevData, fetchedAt: number } | null {
  const row = db().select().from(kvCache).where(eq(kvCache.key, CACHE_KEY)).get()
  if (!row) {
    return null
  }
  try {
    return {
      data: ModelsDevDataJsonSchema.parse(row.value),
      fetchedAt: row.expiresAt * 1000 - HARD_TTL_MS,
    }
  }
  catch {
    return null
  }
}

function writeDbCache(data: ModelsDevData): void {
  try {
    const expiresAt = Math.floor(Date.now() / 1000) + Math.floor(HARD_TTL_MS / 1000)
    db().insert(kvCache).values({ key: CACHE_KEY, value: JSON.stringify(data), expiresAt }).onConflictDoUpdate({ target: kvCache.key, set: { value: JSON.stringify(data), expiresAt } }).run()
  }
  catch {
    // non-critical, ignore
  }
}

function loadDbCacheIntoMemory(): { data: ModelsDevData, fetchedAt: number } | null {
  if (memCache) {
    return { data: memCache, fetchedAt: memFetchedAt }
  }
  if (dbCacheLoaded) {
    return null
  }
  dbCacheLoaded = true
  const fromDb = readDbCache()
  if (!fromDb) {
    return null
  }
  memCache = fromDb.data
  memFetchedAt = fromDb.fetchedAt
  return fromDb
}

function getInMemoryCache(): { data: ModelsDevData, fetchedAt: number } | null {
  return memCache ? { data: memCache, fetchedAt: memFetchedAt } : null
}

function loadMappingCache(): void {
  if (mappingCacheLoaded) {
    return
  }
  mappingCacheLoaded = true
  try {
    for (const row of db().select().from(modelRegistryMappings).all()) {
      mappingCache.set(row.modelId, {
        modelId: row.modelId,
        registryModelId: row.registryModelId,
        matchType: row.matchType,
        ...(row.modelJson
          ? { model: ModelsDevModelSchema.parse(JSON.parse(row.modelJson)) }
          : {}),
        updatedAt: row.updatedAt,
      })
    }
  }
  catch {
    mappingCache.clear()
  }
}

function invalidateDerivedModelCaches(): void {
  costCache.clear()
  contextWindowCache.clear()
}

function applyFresh(data: ModelsDevData): ModelsDevData {
  memCache = data
  memFetchedAt = Date.now()
  dbCacheLoaded = true
  invalidateDerivedModelCaches()
  writeDbCache(data)
  return data
}

async function refreshFromNetwork(): Promise<ModelsDevData | null> {
  const generation = cacheGeneration
  try {
    const fresh = await fetchFromNetwork()
    if (fresh && generation === cacheGeneration) {
      return applyFresh(fresh)
    }
  }
  catch {
    // non-critical — caller falls back to stale
  }
  return null
}

function refreshModelsDevData(): Promise<ModelsDevData | null> {
  if (refreshInFlight) {
    return refreshInFlight
  }
  const promise = refreshFromNetwork().finally(() => {
    if (refreshInFlight === promise) {
      refreshInFlight = null
    }
  })
  refreshInFlight = promise
  return promise
}

function scheduleBackgroundRefresh(): void {
  void refreshModelsDevData().catch(() => {
    refreshInFlight = null
  })
}

/**
 * Load models.dev catalog with stale-while-revalidate:
 * - age < soft TTL → return cache
 * - soft ≤ age < hard → return cache, refresh in background
 * - age ≥ hard (or miss) → await network; fall back to stale on failure
 */
export async function fetchModelsDevData(options?: { forceRefresh?: boolean }): Promise<ModelsDevData | null> {
  const cached = loadDbCacheIntoMemory()
  if (options?.forceRefresh) {
    return (await refreshModelsDevData()) ?? cached?.data ?? getInMemoryCache()?.data ?? null
  }

  if (cached) {
    const age = Date.now() - cached.fetchedAt
    if (age < SOFT_TTL_MS) {
      return cached.data
    }
    if (age < HARD_TTL_MS) {
      scheduleBackgroundRefresh()
      return cached.data
    }
    return (await refreshModelsDevData()) ?? cached.data
  }

  return refreshModelsDevData()
}

/** Load the durable snapshot once, then refresh models.dev without blocking requests. */
export function warmupModelsDevCache(): void {
  loadDbCacheIntoMemory()
  loadMappingCache()
  scheduleBackgroundRefresh()
}

/**
 * Synchronously look up a model's pricing.
 * Resolution order:
 *  1. Global mapping for exact modelId — if mapping.modelJson has cost, use it;
 *     else if mapping has registryModelId, resolve cost via local cache (exact then fuzzy).
 *  2. Fuzzy match modelId on local cache (DB-backed, falls back to in-memory).
 * Returns null if no cost data is found.
 */
export function getCachedModelsDevCost(modelId: string): ModelsDevCost | null {
  if (costCache.has(modelId)) {
    return costCache.get(modelId) ?? null
  }

  loadMappingCache()
  const mapping = mappingCache.get(modelId)
  if (mapping) {
    try {
      if (mapping.model) {
        const cost = mapping.model.cost
        if (cost && (cost.input != null || cost.output != null)) {
          const result = projectModelsDevCost(cost)
          costCache.set(modelId, result)
          return result
        }
      }
      if (mapping.registryModelId) {
        const local = getInMemoryCache()
        if (local) {
          const exact = findModel(local.data, mapping.registryModelId)
          const exactCost = exact?.cost
          if (exactCost && (exactCost.input != null || exactCost.output != null)) {
            const result = projectModelsDevCost(exactCost)
            costCache.set(modelId, result)
            return result
          }
          const fuzzy = findModelFuzzy(local.data, mapping.registryModelId)
          const fuzzyCost = fuzzy?.model?.cost
          if (fuzzyCost && (fuzzyCost.input != null || fuzzyCost.output != null)) {
            const result = projectModelsDevCost(fuzzyCost)
            costCache.set(modelId, result)
            return result
          }
        }
      }
    }
    catch {
      // Invalid optional mapping metadata must not break usage persistence.
    }
  }

  const local = getInMemoryCache()
  if (!local) {
    costCache.set(modelId, null)
    return null
  }
  const result = findModelFuzzy(local.data, modelId)
  const cost = result?.model?.cost
  if (!cost || (cost.input == null && cost.output == null)) {
    costCache.set(modelId, null)
    return null
  }
  const projected = projectModelsDevCost(cost)
  costCache.set(modelId, projected)
  return projected
}

export function getCachedContextWindow(modelId: string): number | null {
  if (contextWindowCache.has(modelId)) {
    return contextWindowCache.get(modelId) ?? null
  }
  const data = getInMemoryCache()?.data
  const contextWindow = data
    ? findModelFuzzy(data, modelId)?.model.limit?.context ?? null
    : null
  contextWindowCache.set(modelId, contextWindow)
  return contextWindow
}

export function updateCachedModelRegistryMapping(
  modelId: string,
  mapping: ModelRegistryMappingEntry | null,
): void {
  loadMappingCache()
  if (mapping) {
    mappingCache.set(modelId, mapping)
  }
  else {
    mappingCache.delete(modelId)
  }
  costCache.delete(modelId)
  contextWindowCache.delete(modelId)
}

function projectModelsDevCost(cost: NonNullable<ModelsDevModel['cost']>): {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
} {
  return {
    input: cost.input ?? 0,
    output: cost.output ?? 0,
    ...(cost.cache_read !== undefined ? { cacheRead: cost.cache_read } : {}),
    ...(cost.cache_write !== undefined ? { cacheWrite: cost.cache_write } : {}),
  }
}

function findModel(data: ModelsDevData, modelId: string): ModelsDevModel | null {
  return aggregateModelsDevRecords(
    modelId,
    Object.entries(data).flatMap(([providerId, provider]) => {
      const model = provider.models?.[modelId]
      return model ? [{ providerId, model }] : []
    }),
  )
}

function findModelWithId(data: ModelsDevData, modelId: string): { id: string, model: ModelsDevModel } | null {
  const model = findModel(data, modelId)
  return model ? { id: modelId, model } : null
}

/**
 * Token-aligned prefix check: split both IDs by `-` and `.` into tokens,
 * then require every candidate token to match the corresponding target token.
 * Rejects when the next unmatched target token is purely numeric (version mismatch).
 * e.g. "glm-5" does NOT match "glm-5-2-search" (next token "2" is numeric),
 * but "claude" DOES match "claude-sonnet-4" (next token "sonnet" is non-numeric).
 */
function tokensAlignedPrefix(candidate: string, target: string): boolean {
  const cTokens = candidate.toLowerCase().split(SEP_RE).filter(Boolean)
  const tTokens = target.toLowerCase().split(SEP_RE).filter(Boolean)

  if (cTokens.length === 0 || cTokens.length > tTokens.length) { return false }

  for (let i = 0; i < cTokens.length; i++) {
    if (cTokens[i] !== tTokens[i]) { return false }
  }

  // All candidate tokens matched — reject if next target token is a version number
  if (cTokens.length < tTokens.length && /^\d+$/.test(tTokens[cTokens.length])) {
    return false
  }

  return true
}

function findModelFuzzy(data: ModelsDevData, modelId: string): { model: ModelsDevModel, matchType: 'exact' | 'fuzzy' } | null {
  // 1. Try exact match first
  const exact = findModel(data, modelId)
  if (exact) {
    return { model: exact, matchType: 'exact' }
  }

  // 2. Try stripping date suffixes (e.g. "claude-sonnet-4-20250514" → "claude-sonnet-4")
  const withoutDate = modelId.replace(DATE_SUFFIX_RE, '')
  if (withoutDate !== modelId) {
    const match = findModel(data, withoutDate)
    if (match) {
      return { model: match, matchType: 'fuzzy' }
    }
  }

  // 3. Try stripping version suffixes (e.g. "gpt-4o-2024-11-20" → "gpt-4o")
  const withoutVersion = modelId.replace(VERSION_SUFFIX_RE, '')
  if (withoutVersion !== modelId && withoutVersion !== withoutDate) {
    const match = findModel(data, withoutVersion)
    if (match) {
      return { model: match, matchType: 'fuzzy' }
    }
  }

  // 3.5. Try normalizing dots ↔ hyphens (e.g. "claude-opus-4-7" ↔ "claude-opus-4.7")
  const dotsToHyphens = modelId.replace(/\./g, '-')
  if (dotsToHyphens !== modelId) {
    const match = findModel(data, dotsToHyphens)
    if (match) {
      return { model: match, matchType: 'fuzzy' }
    }
  }
  const hyphensToDots = modelId.replace(/-(?=\d)/g, '.')
  if (hyphensToDots !== modelId && hyphensToDots !== dotsToHyphens) {
    const match = findModel(data, hyphensToDots)
    if (match) {
      return { model: match, matchType: 'fuzzy' }
    }
  }

  // 4. Token-aligned prefix: registry model is a prefix of this modelId
  for (const provider of Object.values(data)) {
    for (const [id, model] of Object.entries(provider.models)) {
      if (tokensAlignedPrefix(id, modelId)) {
        return { model, matchType: 'fuzzy' }
      }
    }
  }

  // 5. Token-aligned prefix: this modelId is a prefix of a registry model
  for (const provider of Object.values(data)) {
    for (const [id, model] of Object.entries(provider.models)) {
      if (tokensAlignedPrefix(modelId, id)) {
        return { model, matchType: 'fuzzy' }
      }
    }
  }

  return null
}

function findModelFuzzyWithId(data: ModelsDevData, modelId: string): { id: string, model: ModelsDevModel, matchType: 'exact' | 'fuzzy' } | null {
  const exact = findModelWithId(data, modelId)
  if (exact) {
    return { ...exact, matchType: 'exact' }
  }

  const withoutDate = modelId.replace(DATE_SUFFIX_RE, '')
  if (withoutDate !== modelId) {
    const match = findModelWithId(data, withoutDate)
    if (match) {
      return { ...match, matchType: 'fuzzy' }
    }
  }

  const withoutVersion = modelId.replace(VERSION_SUFFIX_RE, '')
  if (withoutVersion !== modelId && withoutVersion !== withoutDate) {
    const match = findModelWithId(data, withoutVersion)
    if (match) {
      return { ...match, matchType: 'fuzzy' }
    }
  }

  // 3.5. Normalize dots ↔ hyphens
  const dotsToHyphens = modelId.replace(/\./g, '-')
  if (dotsToHyphens !== modelId) {
    const match = findModelWithId(data, dotsToHyphens)
    if (match) {
      return { ...match, matchType: 'fuzzy' }
    }
  }
  const hyphensToDots = modelId.replace(/-(?=\d)/g, '.')
  if (hyphensToDots !== modelId && hyphensToDots !== dotsToHyphens) {
    const match = findModelWithId(data, hyphensToDots)
    if (match) {
      return { ...match, matchType: 'fuzzy' }
    }
  }

  for (const provider of Object.values(data)) {
    for (const [id, model] of Object.entries(provider.models)) {
      if (tokensAlignedPrefix(id, modelId)) {
        return { id, model, matchType: 'fuzzy' }
      }
    }
  }

  for (const provider of Object.values(data)) {
    for (const [id, model] of Object.entries(provider.models)) {
      if (tokensAlignedPrefix(modelId, id)) {
        return { id, model, matchType: 'fuzzy' }
      }
    }
  }

  return null
}

function extractCapabilities(model: ModelsDevModel): ModelCapabilities {
  const caps: ModelCapabilities = {}
  if (model.limit?.context != null) {
    caps.contextWindow = model.limit.context
  }
  if (model.limit?.output != null) {
    caps.maxOutput = model.limit.output
  }
  if (model.modalities?.input) {
    caps.inputModalities = model.modalities.input
  }
  if (model.modalities?.output) {
    caps.outputModalities = model.modalities.output
  }
  if (model.reasoning != null) {
    caps.reasoning = model.reasoning
  }
  const reasoningEfforts = readModelsDevReasoningEfforts(model)
  if (reasoningEfforts !== undefined) {
    caps.reasoning = true
    caps.reasoningEfforts = reasoningEfforts
  }
  if (model.tool_call != null) {
    caps.toolCall = model.tool_call
  }
  if (model.temperature != null) {
    caps.temperature = model.temperature
  }
  if (model.structured_output != null) {
    caps.structuredOutput = model.structured_output
  }
  if (model.cost) {
    const cost: NonNullable<ModelCapabilities['cost']> = {}
    if (model.cost.input != null) {
      cost.input = model.cost.input
    }
    if (model.cost.output != null) {
      cost.output = model.cost.output
    }
    if (model.cost.cache_read != null) {
      cost.cacheRead = model.cost.cache_read
    }
    if (model.cost.cache_write != null) {
      cost.cacheWrite = model.cost.cache_write
    }
    if (Object.keys(cost).length > 0) {
      caps.cost = cost
    }
  }
  if (model.family) {
    caps.family = model.family
  }
  if (model.knowledge) {
    caps.knowledgeCutoff = model.knowledge
  }
  if (model.release_date) {
    caps.releaseDate = model.release_date
  }
  return caps
}

/**
 * Core enrichment resolver. Returns the best registry match for a model ID given
 * the current models.dev data and global mapping entries. Resolution order:
 * 1. Global mapping for exact modelId — use mapping.model if present; else resolve
 *    mapping.registryModelId via exact then fuzzy on models.dev.
 * 2. Else findModelFuzzyWithId on modelId.
 * 3. Else null.
 */
export function resolveModelEnrichment(
  modelId: string,
  data: ModelsDevData | null,
  mappings: ModelRegistryMappingEntry[],
): { id: string, model: ModelsDevModel, matchType: 'exact' | 'fuzzy' | 'manual' | 'alias' } | null {
  const mapping = mappings.find(m => m.modelId === modelId)

  if (mapping) {
    if (mapping.model) {
      const id = mapping.model.id ?? mapping.registryModelId ?? modelId
      return { id, model: mapping.model, matchType: mapping.matchType ?? 'manual' }
    }
    if (mapping.registryModelId && data) {
      const exact = findModelWithId(data, mapping.registryModelId)
      if (exact) {
        return { id: exact.id, model: exact.model, matchType: mapping.matchType ?? 'alias' }
      }
      const fuzzy = findModelFuzzyWithId(data, mapping.registryModelId)
      if (fuzzy) {
        return { id: fuzzy.id, model: fuzzy.model, matchType: mapping.matchType ?? 'alias' }
      }
    }
    // Mapping exists but could not resolve to a registry model — fall through to fuzzy
  }

  if (data) {
    return findModelFuzzyWithId(data, modelId)
  }

  return null
}

export function enrichModelsWithRegistryData(
  models: ModelDescriptor[],
  data: ModelsDevData | null,
  mappings: ModelRegistryMappingEntry[],
): ModelDescriptor[] {
  return models.map((model) => {
    const result = resolveModelEnrichment(model.id, data, mappings)

    if (!result) {
      // Strip any stale registry fields when unmatched
      const { registryMatch: _rm, registryModelId: _rmi, registryModelLabel: _rml, ...restCaps } = model.capabilities
      return {
        ...model,
        capabilities: {
          ...restCaps,
          registryMatch: 'unmatched' as const,
        },
      }
    }

    const registryCaps = extractCapabilities(result.model)
    const registryName = result.model.name
    // Strip stale registry-derived fields from inventory caps so registry always wins
    // for enrichment metadata. Upstream-native reasoningEfforts are restored below.
    const {
      registryMatch: _rm,
      registryModelId: _rmi,
      registryModelLabel: _rml,
      cost: _c,
      family: _f,
      knowledgeCutoff: _kc,
      releaseDate: _rd,
      ...inventoryCaps
    } = model.capabilities
    const capabilities: ModelCapabilities = {
      ...inventoryCaps,
      ...registryCaps,
      registryMatch: result.matchType,
      registryModelId: result.id,
      registryModelLabel: registryName ?? result.id,
    }
    // Upstream inventory efforts (Codex / OpenCode / protocol) win over registry projection.
    const upstreamEfforts = inventoryCaps.reasoningEfforts
    if (Array.isArray(upstreamEfforts) && upstreamEfforts.length > 0) {
      capabilities.reasoningEfforts = [...upstreamEfforts]
      if (inventoryCaps.reasoning !== false) {
        capabilities.reasoning = true
      }
    }
    return {
      ...model,
      label: registryName ?? model.label,
      capabilities,
    }
  })
}

export async function enrichModelsFromRegistryMappings(
  models: ModelDescriptor[],
  mappings: ModelRegistryMappingEntry[],
): Promise<ModelDescriptor[]> {
  const data = await fetchModelsDevData()
  return enrichModelsWithRegistryData(models, data, mappings)
}

/**
 * Look up the context window for a single model ID using fuzzy matching.
 * Returns null if the model is not found in the registry.
 */
export async function lookupContextWindow(modelId: string): Promise<number | null> {
  const data = await fetchModelsDevData()
  if (!data) {
    return null
  }
  const result = findModelFuzzy(data, modelId)
  return result?.model?.limit?.context ?? null
}

/**
 * Look up a single model's metadata from models.dev registry using fuzzy matching.
 * Returns null if the model is not found.
 */
export async function lookupModel(modelId: string): Promise<ModelRegistrySearchResult | null> {
  const data = await fetchModelsDevData()
  if (!data) {
    return null
  }
  const result = findModelFuzzyWithId(data, modelId)
  if (!result) {
    return null
  }
  return {
    id: result.id,
    label: result.model.name ?? result.id,
    capabilities: extractCapabilities(result.model),
  }
}

/**
 * Look up a model with fuzzy matching (strips date/version suffixes, prefix matching).
 * Returns the raw ModelsDevModel data for direct use in runtime config bridging.
 */
export async function lookupModelRaw(modelId: string): Promise<ModelsDevModel | null> {
  const data = await fetchModelsDevData()
  if (!data) {
    return null
  }
  const result = findModelFuzzy(data, modelId)
  if (!result) {
    return null
  }
  return result.model
}

export async function lookupModelRawExact(modelId: string): Promise<ModelsDevModel | null> {
  const data = await fetchModelsDevData()
  if (!data) {
    return null
  }
  return findModel(data, modelId)
}

/**
 * Search models by substring match on ID or name.
 * Returns up to `limit` results.
 */
export async function searchModels(query: string, limit = 20): Promise<ModelRegistrySearchResult[]> {
  const data = await fetchModelsDevData()
  if (!data) {
    return []
  }

  const q = query.toLowerCase()
  const results: ModelRegistrySearchResult[] = []

  const modelIds = [...new Set(Object.values(data).flatMap(provider => Object.keys(provider.models)))].toSorted()
  for (const id of modelIds) {
    const model = findModel(data, id)
    if (!model) {
      continue
    }
    const name = model.name ?? id
    const providerNameMatches = Object.values(data).some(provider =>
      provider.models[id]?.name?.toLowerCase().includes(q) === true)
    if (id.toLowerCase().includes(q) || name.toLowerCase().includes(q) || providerNameMatches) {
      results.push({
        id,
        label: name,
        capabilities: extractCapabilities(model),
      })
      if (results.length >= limit) {
        return results
      }
    }
  }

  return results
}
