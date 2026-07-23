import { afterEach, describe, expect, it, vi } from 'vitest'

import { setSsrAddressLookupForTests } from '../../lib/ssrf-guard'
import { setCodexChatgptModelListClientFactoryForTests } from '../chat-runtime-providers/codex/app-server/model-list'
import type { ProviderRequest } from '../provider-contracts/types'
import { ProviderCatalog } from './catalog'
import {
  matchProviderEndpoint,
  resolveAnthropicWireAuth,
} from './provider-endpoint-registry'

function getRequestUrl(input: Parameters<typeof fetch>[0]): string {
  return new Request(input).url
}

function encodeBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function createUnexpiredJwt(): string {
  return [
    encodeBase64Url({ alg: 'none', typ: 'JWT' }),
    encodeBase64Url({ exp: Math.floor(Date.now() / 1000) + 60 * 60 }),
    'signature',
  ].join('.')
}

describe('providerCatalog', () => {
  afterEach(() => {
    setSsrAddressLookupForTests(null)
    setCodexChatgptModelListClientFactoryForTests(null)
    vi.restoreAllMocks()
  })

  it('lists OpenAI-compatible API-key models from the OpenAI-compatible endpoint even for Codex sources', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url !== 'https://openai-compatible.example.test/v1/models') {
        throw new Error(`Unexpected OpenAI-compatible model list request: ${url}`)
      }

      expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-openai-compatible' })
      return new Response(JSON.stringify({ data: [{ id: 'gpt-5-codex' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const provider = new ProviderCatalog().get('openai-compatible')
    if (!provider) {
      throw new Error('OpenAI-compatible provider is not registered')
    }

    const request: ProviderRequest = {
      providerKind: 'openai-compatible',
      label: 'OpenAI-compatible',
      configJson: JSON.stringify({
        baseUrl: 'https://openai-compatible.example.test/v1',
        apiMode: 'chat-completions',
      }),
      secretRef: 'secret-openai-compatible',
      profileId: null,
      providerTargetKind: 'external',
      providerTargetId: 'external-provider-openai-compatible',
      sourceApp: 'codex',
    }

    await expect(provider.listModels(request, {
      readSecret: (secretRef) => {
        expect(secretRef).toBe('secret-openai-compatible')
        return 'sk-openai-compatible'
      },
    })).resolves.toEqual([
      {
        id: 'gpt-5-codex',
        label: 'gpt-5-codex',
        providerKind: 'openai-compatible',
        capabilities: {},
      },
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('lists ChatGPT-auth models from Codex model/list when baseUrl is empty', async () => {
    const accessToken = createUnexpiredJwt()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const codexRequests: Array<{ method: string, params?: unknown }> = []
    const codexClientOptions: Array<{ config?: Record<string, unknown> } | undefined> = []
    setCodexChatgptModelListClientFactoryForTests((options) => {
      codexClientOptions.push(options)
      return {
        pid: null,
        initialize: vi.fn(async () => undefined),
        request: vi.fn(async (method: string, params?: unknown) => {
          codexRequests.push({ method, params })
          if (method === 'account/login/start') {
            return {}
          }
          if (method === 'model/list') {
            return {
              data: [
                {
                  id: 'gpt-5-codex',
                  model: 'gpt-5-codex',
                  displayName: 'GPT-5 Codex',
                  supportedReasoningEfforts: [
                    { reasoningEffort: 'medium', description: 'Medium' },
                    { reasoningEffort: 'high', description: 'High' },
                  ],
                  inputModalities: ['text'],
                },
              ],
              nextCursor: null,
            }
          }
          throw new Error(`unexpected Codex app-server method ${method}`)
        }),
        nextNotification: vi.fn(async () => null),
        close: vi.fn(),
      }
    })
    const updateSecretValue = vi.fn()

    const provider = new ProviderCatalog().get('openai-compatible')
    if (!provider) {
      throw new Error('OpenAI-compatible provider is not registered')
    }

    const request: ProviderRequest = {
      providerKind: 'openai-compatible',
      label: 'RisingWave Team',
      configJson: JSON.stringify({
        baseUrl: '',
        authMode: 'chatgptAuthTokens',
        enabledModels: [],
      }),
      secretRef: 'chatgpt-auth-secret',
      profileId: 'openai',
      providerTargetKind: 'manual',
      providerTargetId: 'openai',
      sourceApp: null,
    }

    await expect(provider.listModels(request, {
      readSecret: (secretRef) => {
        expect(secretRef).toBe('chatgpt-auth-secret')
        return JSON.stringify({
          accessToken,
          refreshToken: 'refresh-token',
          chatgptAccountId: 'chatgpt-account-1',
          chatgptPlanType: 'plus',
        })
      },
      updateSecretValue,
    })).resolves.toEqual([
      {
        id: 'gpt-5-codex',
        label: 'GPT-5 Codex',
        providerKind: 'openai-compatible',
        capabilities: {
          inputModalities: ['text'],
          reasoning: true,
          reasoningEfforts: ['medium', 'high'],
        },
      },
    ])

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(codexClientOptions).toEqual([undefined])
    expect(codexRequests.map(entry => entry.method)).toEqual(['account/login/start', 'model/list'])
    expect(updateSecretValue).not.toHaveBeenCalled()
  })

  it('lists ChatGPT-auth models from Codex model/list with external provider config when baseUrl is set', async () => {
    const accessToken = createUnexpiredJwt()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const codexClientOptions: Array<{ config?: Record<string, unknown> } | undefined> = []
    setCodexChatgptModelListClientFactoryForTests((options) => {
      codexClientOptions.push(options)
      return {
        pid: null,
        initialize: vi.fn(async () => undefined),
        request: vi.fn(async (method: string) => {
          if (method === 'account/login/start') {
            return {}
          }
          if (method === 'model/list') {
            return {
              data: [{ id: 'gpt-chatgpt-auth', model: 'gpt-chatgpt-auth', displayName: 'gpt-chatgpt-auth' }],
              nextCursor: null,
            }
          }
          throw new Error(`unexpected Codex app-server method ${method}`)
        }),
        nextNotification: vi.fn(async () => null),
        close: vi.fn(),
      }
    })

    const provider = new ProviderCatalog().get('openai-compatible')
    if (!provider) {
      throw new Error('OpenAI-compatible provider is not registered')
    }

    const request: ProviderRequest = {
      providerKind: 'openai-compatible',
      label: 'OpenAI',
      configJson: JSON.stringify({
        baseUrl: 'https://api.openai.com/v1',
        authMode: 'chatgptAuthTokens',
      }),
      secretRef: 'chatgpt-auth-secret',
      profileId: null,
      providerTargetKind: 'manual',
      providerTargetId: 'openai-chatgpt-auth-target',
      sourceApp: null,
    }

    await expect(provider.listModels(request, {
      readSecret: () => JSON.stringify({
        accessToken,
        refreshToken: 'refresh-token',
        chatgptAccountId: 'chatgpt-account-1',
        chatgptPlanType: 'plus',
      }),
    })).resolves.toEqual([
      {
        id: 'gpt-chatgpt-auth',
        label: 'gpt-chatgpt-auth',
        providerKind: 'openai-compatible',
        capabilities: {
          inputModalities: [],
          reasoning: false,
          reasoningEfforts: [],
        },
      },
    ])

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(codexClientOptions).toEqual([{
      config: {
        model_provider: 'cradle-openai-compatible',
        model_providers: {
          'cradle-openai-compatible': {
            name: 'Cradle OpenAI Compatible',
            base_url: 'https://api.openai.com/v1',
            wire_api: 'responses',
            requires_openai_auth: true,
          },
        },
      },
    }])
  })

  it('lists Universal models from the OpenAI-compatible endpoint only', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url !== 'https://openai.example.test/v1/models') {
        throw new Error(`Unexpected Universal model list request: ${url}`)
      }

      expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-universal' })
      return new Response(JSON.stringify({ data: [{ id: 'gpt-universal' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const provider = new ProviderCatalog().get('universal')
    if (!provider) {
      throw new Error('Universal provider is not registered')
    }

    const request: ProviderRequest = {
      providerKind: 'universal',
      label: 'Universal',
      configJson: JSON.stringify({
        openaiBaseUrl: 'https://openai.example.test/v1',
        anthropicBaseUrl: 'https://anthropic.example.test/v1',
      }),
      secretRef: 'secret-universal',
      profileId: null,
      providerTargetKind: null,
      providerTargetId: null,
      sourceApp: null,
    }

    await expect(provider.listModels(request, {
      readSecret: (secretRef) => {
        expect(secretRef).toBe('secret-universal')
        return 'sk-universal'
      },
    })).resolves.toEqual([
      {
        id: 'gpt-universal',
        label: 'gpt-universal',
        providerKind: 'universal',
        capabilities: {},
      },
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('matches Volcengine Ark coding endpoints as bearer-token Anthropic wire auth', () => {
    expect(
      matchProviderEndpoint('https://ark.cn-beijing.volces.com/api/coding', 'anthropic'),
    ).toEqual(expect.objectContaining({
      id: 'volcengine-ark-coding',
      providerKind: 'anthropic',
      anthropicWireAuth: 'bearer-token',
    }))

    expect(resolveAnthropicWireAuth('https://ark.cn-beijing.volces.com/api/coding')).toBe('bearer-token')
    expect(resolveAnthropicWireAuth('https://api.anthropic.com/v1')).toBe('api-key')
  })

  it('lists Volcengine Ark coding models with bearer-token Anthropic wire auth', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url !== 'https://ark.cn-beijing.volces.com/api/coding/v1/models') {
        throw new Error(`Unexpected Anthropic model list request: ${url}`)
      }

      expect(init?.headers).toMatchObject({
        'anthropic-version': '2023-06-01',
        'Authorization': 'Bearer volcengine-token',
      })
      expect(init?.headers).not.toHaveProperty('x-api-key')
      return new Response(JSON.stringify({ data: [{ id: 'glm-5.2', display_name: 'GLM 5.2' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const provider = new ProviderCatalog().get('anthropic')
    if (!provider) {
      throw new Error('Anthropic provider is not registered')
    }

    const request: ProviderRequest = {
      providerKind: 'anthropic',
      label: 'Volcengine Ark',
      configJson: JSON.stringify({
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
        model: 'glm-5.2',
      }),
      secretRef: 'secret-volcengine',
      profileId: null,
      providerTargetKind: 'manual',
      providerTargetId: 'volcengine-target',
      sourceApp: null,
    }

    await expect(provider.listModels(request, {
      readSecret: (secretRef) => {
        expect(secretRef).toBe('secret-volcengine')
        return 'volcengine-token'
      },
    })).resolves.toEqual([
      {
        id: 'glm-5.2',
        label: 'GLM 5.2',
        providerKind: 'anthropic',
        capabilities: {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
        },
      },
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
