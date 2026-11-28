import { afterEach, describe, expect, it, vi } from 'vitest'

import { setSsrAddressLookupForTests } from '../../lib/ssrf-guard'
import { setCodexChatgptModelListClientFactoryForTests } from '../chat-runtime-providers/codex/app-server/model-list'
import type { ProviderRequest } from '../provider-contracts/types'
import { ProviderCatalog } from './catalog'
import { readProviderDefaultModelCapabilities } from './model-capabilities'
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

      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sk-openai-compatible')
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

  it('projects model facts declared by an OpenAI-compatible gateway', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({
        object: 'list',
        data: [
          {
            id: 'codex/gpt-6.2-sol',
            display_name: 'GPT-6.2-Sol',
            context_window: 500_000,
            max_context_window: 872_000,
            max_output_tokens: 128_000,
            modalities: { input: ['text', 'image'], output: ['text'] },
            reasoning: true,
            supported_reasoning_levels: [
              { effort: 'low' },
              { effort: 'high' },
              { effort: 'extreme' },
              { effort: 'high' },
            ],
            tool_call: true,
            // Catalog-only fields Cradle does not model must not fail the parse.
            pricing: { prompt: '0.000002', completion: '0.00001' },
            native_endpoints: ['/v1/responses'],
            service_tiers: [{ id: 'priority', name: 'Fast' }],
          },
          {
            id: 'bare/model',
            reasoning: false,
            reasoning_levels: ['high'],
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const provider = new ProviderCatalog().get('openai-compatible')
    if (!provider) {
      throw new Error('OpenAI-compatible provider is not registered')
    }

    await expect(provider.listModels({
      providerKind: 'openai-compatible',
      label: 'Magpie',
      configJson: JSON.stringify({ baseUrl: 'https://gateway.example.test/v1' }),
      secretRef: null,
      profileId: null,
      providerTargetKind: 'manual',
      providerTargetId: 'magpie',
      sourceApp: null,
    }, { readSecret: () => '' })).resolves.toEqual([
      {
        id: 'codex/gpt-6.2-sol',
        label: 'GPT-6.2-Sol',
        providerKind: 'openai-compatible',
        capabilities: {
          // The served window wins over the larger `max_context_window` ceiling.
          contextWindow: 500_000,
          maxOutput: 128_000,
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          reasoning: true,
          // Declared values survive in order, unknown efforts are dropped.
          reasoningEfforts: ['low', 'high'],
          toolCall: true,
        },
      },
      {
        id: 'bare/model',
        label: 'bare/model',
        providerKind: 'openai-compatible',
        // A gateway that declares nothing keeps the bare inventory shape.
        capabilities: { reasoning: false },
      },
    ])
  })

  it('projects declared model facts for universal providers on the OpenAI endpoint', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({
        data: [{
          id: 'gateway/model',
          display_name: 'Gateway Model',
          context_length: 262_144,
          modalities: { input: ['text'] },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const provider = new ProviderCatalog().get('universal')
    if (!provider) {
      throw new Error('Universal provider is not registered')
    }

    await expect(provider.listModels({
      providerKind: 'universal',
      label: 'Gateway',
      configJson: JSON.stringify({ openaiBaseUrl: 'https://gateway.example.test/v1' }),
      secretRef: null,
      profileId: null,
      providerTargetKind: 'manual',
      providerTargetId: 'gateway',
      sourceApp: null,
    }, { readSecret: () => '' })).resolves.toEqual([
      {
        id: 'gateway/model',
        label: 'Gateway Model',
        providerKind: 'universal',
        capabilities: {
          contextWindow: 262_144,
          inputModalities: ['text'],
        },
      },
    ])
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
        codex: { features: { multi_agent: false } },
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
        features: { multi_agent: false },
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

      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sk-universal')
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

  it('lists Universal models from the Anthropic endpoint when no OpenAI URL is configured', async () => {
    setSsrAddressLookupForTests(async () => ['93.184.216.34'])
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url !== 'https://anthropic.example.test/v1/models') {
        throw new Error(`Unexpected Universal model list request: ${url}`)
      }

      const headers = new Headers(init?.headers)
      expect(headers.get('anthropic-version')).toBe('2023-06-01')
      expect(headers.get('x-api-key')).toBe('sk-universal')
      return new Response(JSON.stringify({
        data: [{ id: 'claude-universal', display_name: 'Claude Universal' }],
      }), {
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
        anthropicBaseUrl: 'https://anthropic.example.test/v1',
      }),
      secretRef: 'secret-universal',
      profileId: null,
      providerTargetKind: null,
      providerTargetId: null,
      sourceApp: null,
    }

    await expect(provider.listModels(request, {
      readSecret: () => 'sk-universal',
    })).resolves.toEqual([
      {
        id: 'claude-universal',
        label: 'Claude Universal',
        providerKind: 'universal',
        capabilities: readProviderDefaultModelCapabilities('anthropic'),
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

      const headers = new Headers(init?.headers)
      expect(headers.get('anthropic-version')).toBe('2023-06-01')
      expect(headers.get('Authorization')).toBe('Bearer volcengine-token')
      expect(headers.has('x-api-key')).toBe(false)
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
