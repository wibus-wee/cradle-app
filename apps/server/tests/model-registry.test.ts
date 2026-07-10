import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { modelRegistryMappings, providerTargetModelCache, providerTargets } from '@cradle/db'
import { describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import type { ModelRegistryMappingEntry, ModelsDevModel } from '../src/modules/model-registry/model-info-registry'
import {
  enrichModelsWithRegistryData,
  getCachedModelsDevCost,
  resolveModelEnrichment,
} from '../src/modules/model-registry/model-info-registry'
import { getCachedModelsForTarget, setCachedModelsForTarget } from '../src/modules/provider-catalog/model-cache'
import type { ModelDescriptor } from '../src/modules/provider-contracts/types'

const MODELS_DEV_URL = 'https://models.dev/api.json'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function makeModelsDevData(models: Record<string, Partial<ModelsDevModel>>) {
  return {
    'test-provider': {
      models: Object.fromEntries(
        Object.entries(models).map(([id, partial]) => [id, { id, ...partial }]),
      ),
    },
  }
}

function makeModel(id: string, label: string, providerKind: ModelDescriptor['providerKind'] = 'openai-compatible'): ModelDescriptor {
  return { id, label, providerKind, capabilities: {} }
}

// ── Pure unit tests (no DB required) ──────────────────────────────────────────

describe('resolveModelEnrichment', () => {
  const data = makeModelsDevData({
    'gpt-4o': { name: 'GPT-4o', cost: { input: 2.5, output: 10 }, family: 'gpt-4' },
    'claude-sonnet-4': { name: 'Claude Sonnet 4', cost: { input: 3, output: 15 } },
  })

  it('returns null when data is null and no mapping', () => {
    expect(resolveModelEnrichment('gpt-4o', null, [])).toBeNull()
  })

  it('returns null when no match and no mapping', () => {
    expect(resolveModelEnrichment('unknown-model', data, [])).toBeNull()
  })

  it('resolves an exact match from models.dev', () => {
    const result = resolveModelEnrichment('gpt-4o', data, [])
    expect(result).not.toBeNull()
    expect(result!.id).toBe('gpt-4o')
    expect(result!.matchType).toBe('exact')
  })

  it('resolves a fuzzy match when date suffix is present', () => {
    const result = resolveModelEnrichment('gpt-4o-2024-11-20', data, [])
    expect(result).not.toBeNull()
    expect(result!.id).toBe('gpt-4o')
    expect(result!.matchType).toBe('fuzzy')
  })

  it('uses mapping.model directly with mapping.matchType', () => {
    const overrideModel: ModelsDevModel = { id: 'gpt-4o', name: 'Custom GPT', cost: { input: 1, output: 5 } }
    const mappings: ModelRegistryMappingEntry[] = [{
      modelId: 'my-model',
      matchType: 'manual',
      model: overrideModel,
    }]
    const result = resolveModelEnrichment('my-model', data, mappings)
    expect(result).not.toBeNull()
    expect(result!.model).toBe(overrideModel)
    expect(result!.matchType).toBe('manual')
  })

  it('resolves mapping.registryModelId via exact match on models.dev', () => {
    const mappings: ModelRegistryMappingEntry[] = [{
      modelId: 'my-alias',
      registryModelId: 'gpt-4o',
      matchType: 'alias',
    }]
    const result = resolveModelEnrichment('my-alias', data, mappings)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('gpt-4o')
    expect(result!.matchType).toBe('alias')
  })

  it('resolves mapping.registryModelId via fuzzy when exact is missing', () => {
    // registryModelId has a date suffix → fuzzy resolves to gpt-4o
    const mappings: ModelRegistryMappingEntry[] = [{
      modelId: 'my-alias',
      registryModelId: 'gpt-4o-2024-11-20',
      matchType: 'alias',
    }]
    const result = resolveModelEnrichment('my-alias', data, mappings)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('gpt-4o')
    expect(result!.matchType).toBe('alias')
  })

  it('falls back to fuzzy on modelId when mapping.registryModelId cannot be resolved', () => {
    const mappings: ModelRegistryMappingEntry[] = [{
      modelId: 'gpt-4o-2024-11-20',
      registryModelId: 'nonexistent-registry-model',
      matchType: 'alias',
    }]
    const result = resolveModelEnrichment('gpt-4o-2024-11-20', data, mappings)
    // Falls through to fuzzy on the modelId itself
    expect(result).not.toBeNull()
    expect(result!.id).toBe('gpt-4o')
    expect(result!.matchType).toBe('fuzzy')
  })
})

describe('enrichModelsWithRegistryData', () => {
  const data = makeModelsDevData({
    'gpt-4o': { name: 'GPT-4o', cost: { input: 2.5, output: 10 }, family: 'gpt-4', knowledge: '2024-04' },
  })

  it('merges registry caps with registry winning over stale inventory values', () => {
    // Inventory model has a stale cost and contextWindow that the registry should override
    const inventory: ModelDescriptor[] = [{
      id: 'gpt-4o',
      label: 'old-label',
      providerKind: 'openai-compatible',
      capabilities: {
        contextWindow: 8192,
        cost: { input: 0, output: 0 }, // stale cost from old enrichment
        family: 'stale-family', // stale family
        registryMatch: 'unmatched', // stale registry fields
        registryModelId: 'old-id',
        registryModelLabel: 'Old Label',
      },
    }]
    const result = enrichModelsWithRegistryData(inventory, data, [])
    const model = result[0]
    expect(model.label).toBe('GPT-4o') // updated from registry
    expect(model.capabilities.family).toBe('gpt-4') // registry wins
    expect(model.capabilities.cost?.input).toBe(2.5) // registry wins
    expect(model.capabilities.registryMatch).toBe('exact')
    expect(model.capabilities.registryModelId).toBe('gpt-4o')
  })

  it('strips stale registry fields from inventory caps before merging', () => {
    const inventory: ModelDescriptor[] = [{
      id: 'gpt-4o',
      label: 'GPT-4o',
      providerKind: 'openai-compatible',
      capabilities: {
        registryMatch: 'manual',
        registryModelId: 'some-other-id',
        registryModelLabel: 'Old Label',
        cost: { input: 99 },
        family: 'old-family',
        knowledgeCutoff: '2020-01',
        releaseDate: '2020-01-01',
      },
    }]
    const result = enrichModelsWithRegistryData(inventory, data, [])
    const caps = result[0].capabilities
    expect(caps.registryModelId).toBe('gpt-4o')
    expect(caps.knowledgeCutoff).toBe('2024-04') // from fresh registry
    expect(caps.cost?.input).toBe(2.5) // from fresh registry, not old value
  })

  it('marks unmatched models with registryMatch: unmatched and strips stale registry fields', () => {
    const inventory: ModelDescriptor[] = [{
      id: 'not-in-registry',
      label: 'Unknown',
      providerKind: 'openai-compatible',
      capabilities: {
        registryMatch: 'exact',
        registryModelId: 'old-id',
        registryModelLabel: 'Old',
      },
    }]
    const result = enrichModelsWithRegistryData(inventory, data, [])
    const caps = result[0].capabilities
    expect(caps.registryMatch).toBe('unmatched')
    expect(caps.registryModelId).toBeUndefined()
    expect(caps.registryModelLabel).toBeUndefined()
  })

  it('applies mapping match over fuzzy match', () => {
    const mappings: ModelRegistryMappingEntry[] = [{
      modelId: 'my-gpt',
      registryModelId: 'gpt-4o',
      matchType: 'alias',
    }]
    const inventory: ModelDescriptor[] = [makeModel('my-gpt', 'My GPT')]
    const result = enrichModelsWithRegistryData(inventory, data, mappings)
    expect(result[0].capabilities.registryMatch).toBe('alias')
    expect(result[0].capabilities.registryModelId).toBe('gpt-4o')
  })
})

describe('models.dev reasoning_options projection', () => {
  it('projects effort.values into reasoningEfforts and drops unknown values', () => {
    const data = makeModelsDevData({
      'gpt-5.6': {
        name: 'GPT-5.6',
        reasoning: true,
        reasoning_options: [
          { type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', null] },
        ],
      },
    })
    const result = enrichModelsWithRegistryData([makeModel('gpt-5.6', 'GPT-5.6')], data, [])
    expect(result[0].capabilities.reasoning).toBe(true)
    expect(result[0].capabilities.reasoningEfforts).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  it('declares empty reasoningEfforts for empty options, toggle-only, or budget_tokens-only', () => {
    const data = makeModelsDevData({
      'empty-options': {
        name: 'Empty',
        reasoning: true,
        reasoning_options: [],
      },
      'toggle-only': {
        name: 'Toggle',
        reasoning: true,
        reasoning_options: [{ type: 'toggle' }],
      },
      'budget-only': {
        name: 'Budget',
        reasoning: true,
        reasoning_options: [{ type: 'budget_tokens', min: 1024 }],
      },
    })
    const result = enrichModelsWithRegistryData(
      [
        makeModel('empty-options', 'Empty'),
        makeModel('toggle-only', 'Toggle'),
        makeModel('budget-only', 'Budget'),
      ],
      data,
      [],
    )
    for (const model of result) {
      expect(model.capabilities.reasoning).toBe(true)
      expect(model.capabilities.reasoningEfforts).toEqual([])
    }
  })

  it('keeps effort values when budget_tokens is also present', () => {
    const data = makeModelsDevData({
      'claude-opus-4-5': {
        name: 'Claude Opus 4.5',
        reasoning: true,
        reasoning_options: [
          { type: 'effort', values: ['low', 'medium', 'high'] },
          { type: 'budget_tokens', min: 1024 },
        ],
      },
    })
    const result = enrichModelsWithRegistryData(
      [makeModel('claude-opus-4-5', 'Claude Opus 4.5')],
      data,
      [],
    )
    expect(result[0].capabilities.reasoningEfforts).toEqual(['low', 'medium', 'high'])
  })

  it('preserves upstream-native reasoningEfforts over registry projection', () => {
    const data = makeModelsDevData({
      'gpt-5.6': {
        name: 'GPT-5.6',
        reasoning: true,
        reasoning_options: [
          { type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
        ],
      },
    })
    const inventory: ModelDescriptor[] = [{
      id: 'gpt-5.6',
      label: 'GPT-5.6',
      providerKind: 'openai-compatible',
      capabilities: {
        reasoning: true,
        reasoningEfforts: ['low', 'medium', 'high'],
      },
    }]
    const result = enrichModelsWithRegistryData(inventory, data, [])
    expect(result[0].capabilities.reasoningEfforts).toEqual(['low', 'medium', 'high'])
    expect(result[0].capabilities.family).toBeUndefined()
    expect(result[0].capabilities.registryMatch).toBe('exact')
  })
})

// ── DB-backed tests ───────────────────────────────────────────────────────────

describe('getCachedModelsDevCost (DB-backed)', () => {
  it('returns cost from mapping.modelJson when present', async () => {
    const dataDir = makeTempDir('cradle-data-cost-1-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    try {
      await createServerApp()
      db().insert(modelRegistryMappings).values({
        modelId: 'my-model',
        registryModelId: 'my-model',
        matchType: 'manual',
        modelJson: JSON.stringify({ id: 'my-model', cost: { input: 5, output: 20 } }),
        createdAt: 0,
        updatedAt: 0,
      }).run()
      const cost = getCachedModelsDevCost('my-model')
      expect(cost).toEqual({ input: 5, output: 20 })
    }
    finally {
      shutdownInfra()
      if (previousDataDir !== undefined) { process.env.CRADLE_DATA_DIR = previousDataDir }
      else { delete process.env.CRADLE_DATA_DIR }
      rmSync(dataDir, { recursive: true, force: true })
      vi.restoreAllMocks()
    }
  })

  it('returns null when modelJson has no cost', async () => {
    const dataDir = makeTempDir('cradle-data-cost-2-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    try {
      await createServerApp()
      db().insert(modelRegistryMappings).values({
        modelId: 'my-model',
        registryModelId: 'my-model',
        matchType: 'manual',
        modelJson: JSON.stringify({ id: 'my-model', name: 'My Model' }),
        createdAt: 0,
        updatedAt: 0,
      }).run()
      const cost = getCachedModelsDevCost('my-model')
      expect(cost).toBeNull()
    }
    finally {
      shutdownInfra()
      if (previousDataDir !== undefined) { process.env.CRADLE_DATA_DIR = previousDataDir }
      else { delete process.env.CRADLE_DATA_DIR }
      rmSync(dataDir, { recursive: true, force: true })
      vi.restoreAllMocks()
    }
  })
})

// ── Cache write/read re-enrichment cycle (integration) ───────────────────────

describe('cache write/read re-enrichment cycle', () => {
  const modelsDevData = {
    openai: {
      models: {
        'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', cost: { input: 2.5, output: 10 }, family: 'gpt-4' },
      },
    },
  }

  it('re-enriches inventory from cache after upsertMapping without upstream refetch', async () => {
    const dataDir = makeTempDir('cradle-data-cycle-1-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify(modelsDevData), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    try {
      await createServerApp()

      const targetId = 'test-target-001'
      db().insert(providerTargets).values({
        id: targetId,
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Test Provider',
      }).run()

      const inventoryModels: ModelDescriptor[] = [
        { id: 'gpt-4o', label: 'GPT-4o', providerKind: 'openai-compatible', capabilities: {} },
        { id: 'my-custom-model', label: 'Custom', providerKind: 'openai-compatible', capabilities: {} },
      ]
      setCachedModelsForTarget({ id: targetId }, inventoryModels)

      // Verify cache written without registry fields
      const rawRows = db().select().from(providerTargetModelCache).all()
      expect(rawRows.length).toBe(1)
      const storedModels = JSON.parse(rawRows[0].modelsJson) as ModelDescriptor[]
      expect(storedModels[0].capabilities.registryMatch).toBeUndefined()
      expect(storedModels[0].capabilities.family).toBeUndefined()

      // Read before mapping: gpt-4o should be exact, my-custom-model should be unmatched
      const beforeMapping = await getCachedModelsForTarget({ id: targetId })
      expect(beforeMapping).not.toBeNull()
      const gpt4oBefore = beforeMapping!.models.find(m => m.id === 'gpt-4o')
      expect(gpt4oBefore?.capabilities.registryMatch).toBe('exact')
      expect(gpt4oBefore?.capabilities.family).toBe('gpt-4')
      const customBefore = beforeMapping!.models.find(m => m.id === 'my-custom-model')
      expect(customBefore?.capabilities.registryMatch).toBe('unmatched')

      // Upsert a mapping: my-custom-model → gpt-4o
      db().insert(modelRegistryMappings).values({
        modelId: 'my-custom-model',
        registryModelId: 'gpt-4o',
        matchType: 'alias',
        modelJson: null,
        createdAt: 0,
        updatedAt: 0,
      }).run()

      // Read after mapping: my-custom-model should now reflect the mapping
      const afterMapping = await getCachedModelsForTarget({ id: targetId })
      expect(afterMapping).not.toBeNull()
      const customAfter = afterMapping!.models.find(m => m.id === 'my-custom-model')
      expect(customAfter?.capabilities.registryMatch).toBe('alias')
      expect(customAfter?.capabilities.registryModelId).toBe('gpt-4o')
      expect(customAfter?.capabilities.family).toBe('gpt-4')
      expect(customAfter?.capabilities.cost?.input).toBe(2.5)
    }
    finally {
      shutdownInfra()
      if (previousDataDir !== undefined) { process.env.CRADLE_DATA_DIR = previousDataDir }
      else { delete process.env.CRADLE_DATA_DIR }
      rmSync(dataDir, { recursive: true, force: true })
      vi.restoreAllMocks()
    }
  })

  it('strips enrichment-derived fields when writing to cache', async () => {
    const dataDir = makeTempDir('cradle-data-cycle-2-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    try {
      await createServerApp()

      const targetId = 'test-target-002'
      db().insert(providerTargets).values({
        id: targetId,
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Test Provider 2',
      }).run()

      const enrichedModels: ModelDescriptor[] = [{
        id: 'gpt-4o',
        label: 'GPT-4o',
        providerKind: 'openai-compatible',
        capabilities: {
          registryMatch: 'exact',
          registryModelId: 'gpt-4o',
          registryModelLabel: 'GPT-4o',
          cost: { input: 99, output: 99 },
          family: 'should-be-stripped',
          knowledgeCutoff: '2023-01',
          releaseDate: '2023-01-01',
        },
      }]
      setCachedModelsForTarget({ id: targetId }, enrichedModels)

      const rawRows = db().select().from(providerTargetModelCache).all()
      expect(rawRows.length).toBe(1)
      const stored = JSON.parse(rawRows[0].modelsJson) as ModelDescriptor[]
      const caps = stored[0].capabilities

      expect(caps.registryMatch).toBeUndefined()
      expect(caps.registryModelId).toBeUndefined()
      expect(caps.registryModelLabel).toBeUndefined()
      expect(caps.cost).toBeUndefined()
      expect(caps.family).toBeUndefined()
      expect(caps.knowledgeCutoff).toBeUndefined()
      expect(caps.releaseDate).toBeUndefined()
    }
    finally {
      shutdownInfra()
      if (previousDataDir !== undefined) { process.env.CRADLE_DATA_DIR = previousDataDir }
      else { delete process.env.CRADLE_DATA_DIR }
      rmSync(dataDir, { recursive: true, force: true })
      vi.restoreAllMocks()
    }
  })
})
