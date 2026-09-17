import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { modelRegistryMappings, providerTargetModelCache, providerTargets } from '@cradle/db'
import { Elysia } from 'elysia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createErrorHandler } from '../../http/error-mapping'
import { db, shutdownInfra } from '../../infra'
import { setSsrAddressLookupForTests } from '../../lib/ssrf-guard'
import { providers } from './index'
import {
  clearCachedModelRefreshFailure,
  getCachedModelRefreshFailure,
  setCachedModelRefreshFailure,
  setCachedModelsForTarget,
} from './model-cache'
import { queryProviderTargetModels } from './target-model-query'

const UPSTREAM_MODELS_URL = 'https://provider.test/v1/models'
const MODELS_DEV_URL = 'https://models.dev/api.json'
const STALE_AGE_S = 2 * 60 * 60 // beyond the 1h soft TTL

const modelsDevData = {
  'test-provider': {
    name: 'Test Provider',
    models: {
      'gpt-5': {
        id: 'gpt-5',
        name: 'GPT-5',
        family: 'gpt-5-family',
        cost: { input: 1, output: 2 },
      },
    },
  },
}

let dataDir: string
let previousDataDir: string | undefined
let upstreamCalls: number
let upstreamHandler: () => Response
const usedTargetIds: string[] = []

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cradle-target-model-query-'))
}

function seedTarget(
  id: string,
  overrides: Partial<typeof providerTargets.$inferInsert> = {},
): void {
  usedTargetIds.push(id)
  db()
    .insert(providerTargets)
    .values({
      id,
      kind: 'manual',
      providerKind: 'openai-compatible',
      displayName: `Target ${id}`,
      enabled: true,
      connectionConfigJson: JSON.stringify({ baseUrl: 'https://provider.test/v1' }),
      enabledModelsJson: '[]',
      customModelsJson: '[]',
      ...overrides,
    })
    .run()
}

function seedInventoryCache(targetId: string, modelIds: string[], fetchedAt?: number): void {
  db()
    .insert(providerTargetModelCache)
    .values({
      providerTargetId: targetId,
      modelsJson: JSON.stringify(modelIds.map(id => ({
        id,
        label: id,
        providerKind: 'openai-compatible',
        capabilities: {},
      }))),
      fetchedAt: fetchedAt ?? Math.floor(Date.now() / 1000),
    })
    .run()
}

function okUpstream(modelIds: string[]): () => Response {
  return () => new Response(JSON.stringify({ data: modelIds.map(id => ({ id })) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function failingUpstream(): () => Response {
  return () => {
    throw new Error('upstream unreachable')
  }
}

beforeEach(() => {
  dataDir = makeTempDir()
  previousDataDir = process.env.CRADLE_DATA_DIR
  process.env.CRADLE_DATA_DIR = dataDir
  upstreamCalls = 0
  upstreamHandler = okUpstream(['gpt-5', 'local-1'])
  setSsrAddressLookupForTests(async () => ['93.184.216.34'])
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new Request(input).url
    if (url === UPSTREAM_MODELS_URL) {
      upstreamCalls += 1
      return upstreamHandler()
    }
    if (url === MODELS_DEV_URL) {
      return new Response(JSON.stringify(modelsDevData), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
})

afterEach(() => {
  for (const id of usedTargetIds) {
    clearCachedModelRefreshFailure({ id })
  }
  usedTargetIds.length = 0
  shutdownInfra()
  setSsrAddressLookupForTests(null)
  vi.restoreAllMocks()
  rmSync(dataDir, { recursive: true, force: true })
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
})

describe('queryProviderTargetModels · cached freshness', () => {
  it('serves a fresh cache without contacting upstream', async () => {
    seedTarget('t-cached-fresh')
    seedInventoryCache('t-cached-fresh', ['gpt-5'])

    const result = await queryProviderTargetModels({ target: { id: 't-cached-fresh' }, freshness: 'cached' })

    expect(upstreamCalls).toBe(0)
    expect(result.cached).toBe(true)
    expect(result.stale).toBe(false)
    expect(result.coolingDown).toBe(false)
    expect(result.fetchedAt).toEqual(expect.any(Number))
    expect(result.providerLabel).toBe('Target t-cached-fresh')
    expect(result.models.map(model => model.id)).toEqual(['gpt-5'])
  })

  it('serves a stale cache without contacting upstream', async () => {
    seedTarget('t-cached-stale')
    seedInventoryCache('t-cached-stale', ['gpt-5'], Math.floor(Date.now() / 1000) - STALE_AGE_S)

    const result = await queryProviderTargetModels({ target: { id: 't-cached-stale' }, freshness: 'cached' })

    expect(upstreamCalls).toBe(0)
    expect(result.cached).toBe(true)
    expect(result.stale).toBe(true)
    expect(result.models.map(model => model.id)).toEqual(['gpt-5'])
  })

  it('returns an empty result on a cold cache and reports cooldown state', async () => {
    seedTarget('t-cached-cold')
    setCachedModelRefreshFailure({ id: 't-cached-cold' })

    const result = await queryProviderTargetModels({ target: { id: 't-cached-cold' }, freshness: 'cached' })

    expect(upstreamCalls).toBe(0)
    expect(result).toMatchObject({ models: [], cached: false, fetchedAt: null, stale: false, coolingDown: true })
  })
})

describe('queryProviderTargetModels · refresh freshness', () => {
  it('fetches unconditionally on a warm cache and persists inventory', async () => {
    seedTarget('t-refresh-warm')
    seedInventoryCache('t-refresh-warm', ['old-model'])

    const result = await queryProviderTargetModels({ target: { id: 't-refresh-warm' }, freshness: 'refresh' })

    expect(upstreamCalls).toBe(1)
    expect(result.cached).toBe(false)
    expect(result.models.map(model => model.id)).toEqual(['gpt-5', 'local-1'])
    const row = db().select().from(providerTargetModelCache).all()
    expect(row).toHaveLength(1)
    expect(JSON.parse(row[0].modelsJson).map((model: { id: string }) => model.id)).toEqual(['gpt-5', 'local-1'])
  })

  it('bypasses the failed-refresh cooldown and clears the marker on success', async () => {
    seedTarget('t-refresh-cooldown')
    setCachedModelRefreshFailure({ id: 't-refresh-cooldown' })

    const result = await queryProviderTargetModels({ target: { id: 't-refresh-cooldown' }, freshness: 'refresh' })

    expect(upstreamCalls).toBe(1)
    expect(result.models.map(model => model.id)).toEqual(['gpt-5', 'local-1'])
    expect(getCachedModelRefreshFailure({ id: 't-refresh-cooldown' })).toBeNull()
  })

  it('marks the failure cooldown and throws when the fetch fails without fallback', async () => {
    seedTarget('t-refresh-fail')
    upstreamHandler = failingUpstream()

    await expect(queryProviderTargetModels({ target: { id: 't-refresh-fail' }, freshness: 'refresh' }))
      .rejects
.toMatchObject({ code: 'provider_models_unavailable' })

    expect(upstreamCalls).toBe(1)
    expect(getCachedModelRefreshFailure({ id: 't-refresh-fail' })).not.toBeNull()
    expect(db().select().from(providerTargetModelCache).all()).toHaveLength(0)
  })

  it('falls back to stored custom models when upstream fails', async () => {
    seedTarget('t-refresh-custom', {
      customModelsJson: JSON.stringify([{ id: 'custom-1', label: 'Custom One' }]),
    })
    upstreamHandler = failingUpstream()

    const result = await queryProviderTargetModels({ target: { id: 't-refresh-custom' }, freshness: 'refresh' })

    expect(upstreamCalls).toBe(1)
    expect(result.models.map(model => model.id)).toEqual(['custom-1'])
    expect(getCachedModelRefreshFailure({ id: 't-refresh-custom' })).toBeNull()
  })

  it('falls back to the configured default model when upstream fails', async () => {
    seedTarget('t-refresh-default', {
      connectionConfigJson: JSON.stringify({ baseUrl: 'https://provider.test/v1', model: 'fallback-m' }),
    })
    upstreamHandler = failingUpstream()

    const result = await queryProviderTargetModels({ target: { id: 't-refresh-default' }, freshness: 'refresh' })

    expect(upstreamCalls).toBe(1)
    expect(result.models.map(model => model.id)).toEqual(['fallback-m'])
  })

  it('merges custom models into a successful inventory and prunes discovered entries', async () => {
    seedTarget('t-refresh-merge', {
      customModelsJson: JSON.stringify([
        { id: 'gpt-5', label: 'Shadowed Custom' },
        { id: 'custom-2', label: 'Custom Two' },
      ]),
    })
    upstreamHandler = okUpstream(['gpt-5'])

    const result = await queryProviderTargetModels({ target: { id: 't-refresh-merge' }, freshness: 'refresh' })

    expect(result.models.map(model => model.id)).toEqual(['gpt-5', 'custom-2'])
    // 'gpt-5' was discovered upstream and pruned from stored custom models.
    const row = db().select().from(providerTargets).all()[0]
    expect(JSON.parse(row.customModelsJson)).toEqual([{ id: 'custom-2', label: 'Custom Two' }])
  })
})

describe('queryProviderTargetModels · prefer-cache freshness', () => {
  it('serves a fresh cache with zero upstream calls', async () => {
    seedTarget('t-prefer-fresh')
    seedInventoryCache('t-prefer-fresh', ['gpt-5'])

    const result = await queryProviderTargetModels({ target: { id: 't-prefer-fresh' }, freshness: 'prefer-cache' })

    expect(upstreamCalls).toBe(0)
    expect(result).toMatchObject({ cached: true, stale: false, coolingDown: false })
    expect(result.models.map(model => model.id)).toEqual(['gpt-5'])
  })

  it('refreshes a stale cache with exactly one fetch', async () => {
    seedTarget('t-prefer-stale')
    seedInventoryCache('t-prefer-stale', ['old-model'], Math.floor(Date.now() / 1000) - STALE_AGE_S)

    const result = await queryProviderTargetModels({ target: { id: 't-prefer-stale' }, freshness: 'prefer-cache' })

    expect(upstreamCalls).toBe(1)
    expect(result.cached).toBe(false)
    expect(result.models.map(model => model.id)).toEqual(['gpt-5', 'local-1'])
  })

  it('fetches once on a cold cache', async () => {
    seedTarget('t-prefer-cold')

    const result = await queryProviderTargetModels({ target: { id: 't-prefer-cold' }, freshness: 'prefer-cache' })

    expect(upstreamCalls).toBe(1)
    expect(result.models.map(model => model.id)).toEqual(['gpt-5', 'local-1'])
  })

  it('serves a stale cache during the failure cooldown without fetching', async () => {
    seedTarget('t-prefer-stale-cooldown')
    seedInventoryCache('t-prefer-stale-cooldown', ['old-model'], Math.floor(Date.now() / 1000) - STALE_AGE_S)
    setCachedModelRefreshFailure({ id: 't-prefer-stale-cooldown' })

    const result = await queryProviderTargetModels({ target: { id: 't-prefer-stale-cooldown' }, freshness: 'prefer-cache' })

    expect(upstreamCalls).toBe(0)
    expect(result).toMatchObject({ cached: true, stale: true, coolingDown: true })
    expect(result.models.map(model => model.id)).toEqual(['old-model'])
  })

  it('returns an empty cooling-down result on a cold cache during cooldown', async () => {
    seedTarget('t-prefer-cold-cooldown')
    setCachedModelRefreshFailure({ id: 't-prefer-cold-cooldown' })

    const result = await queryProviderTargetModels({ target: { id: 't-prefer-cold-cooldown' }, freshness: 'prefer-cache' })

    expect(upstreamCalls).toBe(0)
    expect(result).toMatchObject({ models: [], cached: false, fetchedAt: null, coolingDown: true })
  })

  it('serves the stale cache when the governed fetch fails', async () => {
    seedTarget('t-prefer-stale-fail')
    seedInventoryCache('t-prefer-stale-fail', ['old-model'], Math.floor(Date.now() / 1000) - STALE_AGE_S)
    upstreamHandler = failingUpstream()

    const result = await queryProviderTargetModels({ target: { id: 't-prefer-stale-fail' }, freshness: 'prefer-cache' })

    expect(upstreamCalls).toBe(1)
    expect(result).toMatchObject({ cached: true, stale: true, coolingDown: true })
    expect(result.models.map(model => model.id)).toEqual(['old-model'])
    expect(getCachedModelRefreshFailure({ id: 't-prefer-stale-fail' })).not.toBeNull()
  })

  it('throws on a cold-cache fetch failure, then suppresses retries during cooldown', async () => {
    seedTarget('t-prefer-cold-fail')
    upstreamHandler = failingUpstream()

    await expect(queryProviderTargetModels({ target: { id: 't-prefer-cold-fail' }, freshness: 'prefer-cache' }))
      .rejects
.toMatchObject({ code: 'provider_models_unavailable' })
    expect(upstreamCalls).toBe(1)

    const result = await queryProviderTargetModels({ target: { id: 't-prefer-cold-fail' }, freshness: 'prefer-cache' })
    expect(upstreamCalls).toBe(1)
    expect(result).toMatchObject({ models: [], cached: false, coolingDown: true })
  })
})

describe('queryProviderTargetModels · stored visibility', () => {
  it('returns every model when the stored list is empty', async () => {
    seedTarget('t-vis-all', { enabledModelsJson: '[]' })
    seedInventoryCache('t-vis-all', ['gpt-5', 'local-1'])

    const result = await queryProviderTargetModels({
      target: { id: 't-vis-all' },
      freshness: 'cached',
      visibility: 'stored',
    })

    expect(result.models.map(model => model.id)).toEqual(['gpt-5', 'local-1'])
  })

  it('filters to the stored subset', async () => {
    seedTarget('t-vis-subset', { enabledModelsJson: JSON.stringify(['gpt-5']) })
    seedInventoryCache('t-vis-subset', ['gpt-5', 'local-1'])

    const result = await queryProviderTargetModels({
      target: { id: 't-vis-subset' },
      freshness: 'cached',
      visibility: 'stored',
    })

    expect(result.models.map(model => model.id)).toEqual(['gpt-5'])
  })

  it('short-circuits an all-disabled target without fetching', async () => {
    seedTarget('t-vis-disabled', { enabledModelsJson: JSON.stringify(['__all_disabled__']) })

    const result = await queryProviderTargetModels({
      target: { id: 't-vis-disabled' },
      freshness: 'prefer-cache',
      visibility: 'stored',
    })

    expect(upstreamCalls).toBe(0)
    expect(result.models).toEqual([])
  })
})

describe('queryProviderTargetModels · enrichment and capability projection', () => {
  it('enriches cached inventory and projects provider capability defaults on read', async () => {
    seedTarget('t-enrich')
    seedInventoryCache('t-enrich', ['gpt-5', 'local-1'])

    const result = await queryProviderTargetModels({ target: { id: 't-enrich' }, freshness: 'cached' })

    expect(upstreamCalls).toBe(0)
    const gpt5 = result.models.find(model => model.id === 'gpt-5')
    expect(gpt5?.capabilities.registryMatch).toBe('exact')
    expect(gpt5?.capabilities.family).toBe('gpt-5-family')
    expect(gpt5?.capabilities.cost).toEqual({ input: 1, output: 2 })
    expect(result.models.find(model => model.id === 'local-1')?.capabilities.registryMatch).toBe('unmatched')
  })

  it('re-enriches from a new mapping without rewriting the cache or refetching', async () => {
    seedTarget('t-remap')
    seedInventoryCache('t-remap', ['custom-x'])

    const before = await queryProviderTargetModels({ target: { id: 't-remap' }, freshness: 'cached' })
    expect(before.models[0].capabilities.registryMatch).toBe('unmatched')

    db().insert(modelRegistryMappings).values({
      modelId: 'custom-x',
      registryModelId: 'gpt-5',
      matchType: 'alias',
      modelJson: null,
      createdAt: 0,
      updatedAt: 0,
    }).run()

    const after = await queryProviderTargetModels({ target: { id: 't-remap' }, freshness: 'cached' })
    expect(upstreamCalls).toBe(0)
    expect(after.models[0].capabilities.registryMatch).toBe('alias')
    expect(after.models[0].capabilities.registryModelId).toBe('gpt-5')
    // The stored row is still raw inventory.
    const stored = db().select().from(providerTargetModelCache).all()[0]
    expect(JSON.parse(stored.modelsJson)[0].capabilities).toEqual({})
  })
})

describe('providers routes · thin adapters over the target query', () => {
  function createRouteApp() {
    return new Elysia().onError(createErrorHandler()).use(providers)
  }

  it('route POST /providers/models refreshes through the target query and returns the model array', async () => {
    seedTarget('t-route-post')

    const app = createRouteApp()
    const response = await app.handle(new Request('http://localhost/providers/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerKind: 'openai-compatible',
        label: 'ignored when a target is present',
        config: {},
        secretRef: null,
        profileId: null,
        providerTargetId: 't-route-post',
      }),
    }))

    expect(response.status).toBe(200)
    const models = await response.json()
    expect(models.map((model: { id: string }) => model.id)).toEqual(['gpt-5', 'local-1'])
    expect(upstreamCalls).toBe(1)
    expect(db().select().from(providerTargetModelCache).all()).toHaveLength(1)
  })

  it('route POST /providers/models without a target lists without caching', async () => {
    const app = createRouteApp()
    const response = await app.handle(new Request('http://localhost/providers/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerKind: 'openai-compatible',
        label: 'Ad-hoc provider',
        config: { baseUrl: 'https://provider.test/v1' },
        secretRef: null,
        profileId: null,
        providerTargetId: null,
      }),
    }))

    expect(response.status).toBe(200)
    expect(upstreamCalls).toBe(1)
    expect(db().select().from(providerTargetModelCache).all()).toHaveLength(0)
  })

  it('route POST /providers/models returns the resolved-target 404 for unknown targets', async () => {
    const app = createRouteApp()
    const response = await app.handle(new Request('http://localhost/providers/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerKind: 'openai-compatible',
        label: 'x',
        config: {},
        secretRef: null,
        profileId: null,
        providerTargetId: 'missing-target',
      }),
    }))

    expect(response.status).toBe(404)
    expect(upstreamCalls).toBe(0)
  })

  it('route GET /providers/targets/:id/models-cache maps the cached query result', async () => {
    seedTarget('t-route-cache')
    seedInventoryCache('t-route-cache', ['gpt-5'])

    const app = createRouteApp()
    const response = await app.handle(new Request('http://localhost/providers/targets/t-route-cache/models-cache'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: true,
      stale: false,
      coolingDown: false,
      providerLabel: 'Target t-route-cache',
    })
    expect(upstreamCalls).toBe(0)
  })

  it('route GET /providers/targets/:id/models-cache reports an empty cold cache', async () => {
    seedTarget('t-route-cold')

    const app = createRouteApp()
    const response = await app.handle(new Request('http://localhost/providers/targets/t-route-cold/models-cache'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      models: [],
      cached: false,
      stale: false,
      coolingDown: false,
      providerLabel: 'Target t-route-cold',
    })
    expect(upstreamCalls).toBe(0)
  })

  it('route GET /providers/:profileId/models-cache maps the cached query result', async () => {
    seedTarget('t-route-profile')
    setCachedModelsForTarget({ id: 't-route-profile' }, [{
      id: 'gpt-5',
      label: 'gpt-5',
      providerKind: 'openai-compatible',
      capabilities: {},
    }])

    const app = createRouteApp()
    const response = await app.handle(new Request('http://localhost/providers/t-route-profile/models-cache'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cached: true,
      stale: false,
      coolingDown: false,
    })
    expect(upstreamCalls).toBe(0)
  })
})
