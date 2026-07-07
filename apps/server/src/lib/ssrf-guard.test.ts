import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProviderCatalog } from '../modules/provider-catalog/catalog'
import type { ProviderRequest } from '../modules/provider-contracts/types'
import {
  guardedFetch,
  setSsrAddressLookupForTests,
} from './ssrf-guard'

function usePublicAddressLookup(): void {
  setSsrAddressLookupForTests(async (hostname) => {
    if (hostname === 'localhost') {
      return ['127.0.0.1']
    }
    return ['93.184.216.34']
  })
}

function createProviderRequest(baseUrl: string): ProviderRequest {
  return {
    providerKind: 'openai-compatible',
    label: 'Local Provider',
    configJson: JSON.stringify({ baseUrl }),
    secretRef: 'secret-provider',
    profileId: null,
    providerTargetKind: 'manual',
    providerTargetId: 'provider-target',
    sourceApp: null,
  }
}

describe('ssrf guard', () => {
  afterEach(() => {
    delete process.env.CRADLE_ALLOW_PRIVATE_PROVIDER_HOSTS
    vi.restoreAllMocks()
    usePublicAddressLookup()
  })

  it('blocks redirects to loopback targets before fetching the redirected URL', async () => {
    usePublicAddressLookup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      expect(init?.redirect).toBe('manual')
      if (url === 'https://public.example.test/start') {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/admin' },
        })
      }
      throw new Error(`Blocked redirect target was fetched: ${url}`)
    })

    await expect(guardedFetch('https://public.example.test/start')).rejects.toMatchObject({
      code: 'link_preview_blocked_host',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('allows public targets through the guarded fetch path', async () => {
    usePublicAddressLookup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(new Request(input).url).toBe('https://public.example.test/models')
      expect(init?.redirect).toBe('manual')
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const response = await guardedFetch('https://public.example.test/models')
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('blocks private provider model endpoints by default', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const provider = new ProviderCatalog().get('openai-compatible')
    if (!provider) {
      throw new Error('OpenAI-compatible provider is not registered')
    }

    await expect(provider.listModels(createProviderRequest('http://127.0.0.1:11434/v1'), {
      readSecret: () => 'local-secret',
    })).rejects.toMatchObject({
      code: 'provider_base_url_blocked_host',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('allows explicitly allowlisted private provider hosts', async () => {
    process.env.CRADLE_ALLOW_PRIVATE_PROVIDER_HOSTS = '127.0.0.1'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(new Request(input).url).toBe('http://127.0.0.1:11434/v1/models')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer local-secret' })
      expect(init?.redirect).toBe('manual')
      return new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const provider = new ProviderCatalog().get('openai-compatible')
    if (!provider) {
      throw new Error('OpenAI-compatible provider is not registered')
    }

    await expect(provider.listModels(createProviderRequest('http://127.0.0.1:11434/v1'), {
      readSecret: () => 'local-secret',
    })).resolves.toEqual([
      {
        id: 'local-model',
        label: 'local-model',
        providerKind: 'openai-compatible',
        capabilities: {},
      },
    ])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
