import { kvCache, providerTargets } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../infra'
import { setSsrAddressLookupForTests } from '../../lib/ssrf-guard'
import { readCachedConnectionTest, testProviderConnection } from './connection-test'

const TARGET_ID = 'connection-test-target'
const DEEP_TARGET_ID = 'connection-test-deep-target'
const UNKNOWN_MODEL = 'gpt-missing'

function getRequestUrl(input: Parameters<typeof fetch>[0]): string {
  return new Request(input).url
}

function insertProviderTarget(id: string, connectionConfig: Record<string, unknown> = {
  baseUrl: 'https://api.example.test/v1',
}): void {
  db().insert(providerTargets).values({
    id,
    kind: 'manual',
    providerKind: 'openai-compatible',
    displayName: 'Connection Test Provider',
    enabled: true,
    connectionConfigJson: JSON.stringify(connectionConfig),
    enabledModelsJson: '[]',
    customModelsJson: '[]',
  }).run()
}

function mockModelsListResponse(models: Array<{ id: string }>): Response {
  return new Response(JSON.stringify({ data: models }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('testProviderConnection', () => {
  afterEach(() => {
    setSsrAddressLookupForTests(null)
    vi.restoreAllMocks()
    for (const id of [TARGET_ID, DEEP_TARGET_ID]) {
      db().delete(providerTargets).where(eq(providerTargets.id, id)).run()
      db().delete(kvCache).where(eq(kvCache.key, `provider-test-result:${id}`)).run()
    }
  })

  it('classifies HTTP 401 from the model list endpoint as auth_failed', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    insertProviderTarget(TARGET_ID)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('invalid api key', { status: 401 }))

    const result = await testProviderConnection(TARGET_ID, {})

    expect(result.status).toBe('auth_failed')
    expect(result.detail).toContain('401')
    expect(result.modelsCount).toBeUndefined()
  })

  it('classifies a refused connection as network_error', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    insertProviderTarget(TARGET_ID)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 10.0.0.1:443') }),
    )

    const result = await testProviderConnection(TARGET_ID, {})

    expect(result.status).toBe('network_error')
  })

  it('classifies HTTP 500 from the model list endpoint as endpoint_error', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    insertProviderTarget(TARGET_ID)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('internal error', { status: 500 }))

    const result = await testProviderConnection(TARGET_ID, {})

    expect(result.status).toBe('endpoint_error')
    expect(result.detail).toContain('500')
  })

  it('reports ok with latency and modelsCount on the happy path and persists the result', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    insertProviderTarget(TARGET_ID)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = getRequestUrl(input)
      if (url !== 'https://api.example.test/v1/models') {
        throw new Error(`Unexpected request: ${url}`)
      }
      return mockModelsListResponse([{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }])
    })

    const result = await testProviderConnection(TARGET_ID, {})

    expect(result.status).toBe('ok')
    expect(result.modelsCount).toBe(2)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(() => new Date(result.checkedAt).toISOString()).not.toThrow()

    const cachedRow = db()
      .select()
      .from(kvCache)
      .where(eq(kvCache.key, `provider-test-result:${TARGET_ID}`))
      .get()
    expect(cachedRow).toBeDefined()
    expect(JSON.parse(cachedRow!.value)).toEqual(result)
    expect(cachedRow!.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('round-trips the result through readCachedConnectionTest', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    insertProviderTarget(TARGET_ID)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockModelsListResponse([{ id: 'gpt-4o' }]))

    const result = await testProviderConnection(TARGET_ID, {})

    await expect(readCachedConnectionTest(TARGET_ID)).resolves.toEqual(result)
    await expect(readCachedConnectionTest('never-tested-target')).resolves.toBeNull()
  })

  it('classifies a deep-test HTTP 404 as model_unavailable', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    insertProviderTarget(DEEP_TARGET_ID)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = getRequestUrl(input)
      if (url === 'https://api.example.test/v1/models') {
        return mockModelsListResponse([{ id: 'gpt-4o' }])
      }
      if (url === 'https://api.example.test/v1/chat/completions') {
        return new Response(JSON.stringify({
          error: { message: `The model \`${UNKNOWN_MODEL}\` does not exist` },
        }), { status: 404, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const result = await testProviderConnection(DEEP_TARGET_ID, { deep: true, model: UNKNOWN_MODEL })

    expect(result.status).toBe('model_unavailable')
    expect(result.deep).toBe(true)
    expect(result.model).toBe(UNKNOWN_MODEL)
  })

  it('keeps the stage-1 verdict when a deep test succeeds', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    insertProviderTarget(DEEP_TARGET_ID)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = getRequestUrl(input)
      if (url === 'https://api.example.test/v1/models') {
        return mockModelsListResponse([{ id: 'gpt-4o' }])
      }
      if (url === 'https://api.example.test/v1/chat/completions') {
        return new Response(JSON.stringify({ id: 'chatcmpl-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const result = await testProviderConnection(DEEP_TARGET_ID, { deep: true, model: 'gpt-4o' })

    expect(result.status).toBe('ok')
    expect(result.deep).toBe(true)
    expect(result.model).toBe('gpt-4o')
    expect(result.modelsCount).toBe(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('throws a 404 AppError for an unknown provider target', async () => {
    await expect(testProviderConnection('missing-provider-target', {})).rejects.toMatchObject({
      code: 'provider_target_not_found',
      status: 404,
    })
  })
})
