import { afterEach, describe, expect, it, vi } from 'vitest'

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

describe('providerCatalog', () => {
  afterEach(() => {
    setCodexChatgptModelListClientFactoryForTests(null)
    vi.restoreAllMocks()
  })

  it('lists Codex source API-key models through Codex app-server', async () => {
    const clientOptions: unknown[] = []
    const requests: Array<{ method: string, params?: unknown }> = []
    const close = vi.fn()
    setCodexChatgptModelListClientFactoryForTests((options) => {
      clientOptions.push(options)
      return {
        async initialize() {},
        async request(method, params) {
          requests.push({ method, params })
          if (method === 'model/list') {
            return {
              data: [
                {
                  id: 'gpt-5-codex',
                  displayName: 'GPT-5 Codex',
                  inputModalities: ['text'],
                  supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
                },
              ],
            }
          }
          throw new Error(`Unexpected Codex app-server request: ${method}`)
        },
        async nextNotification() {
          return null
        },
        close,
      }
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const provider = new ProviderCatalog().get('openai-compatible')
    if (!provider) {
      throw new Error('OpenAI-compatible provider is not registered')
    }

    const request: ProviderRequest = {
      providerKind: 'openai-compatible',
      label: 'Codex Official',
      configJson: JSON.stringify({ apiMode: 'chat-completions' }),
      secretRef: 'secret-codex',
      profileId: null,
      providerTargetKind: 'external',
      providerTargetId: 'external-provider-codex',
      sourceApp: 'codex',
    }

    await expect(provider.listModels(request, {
      readSecret: (secretRef) => {
        expect(secretRef).toBe('secret-codex')
        return 'sk-codex'
      },
    })).resolves.toEqual([
      {
        id: 'gpt-5-codex',
        label: 'GPT-5 Codex',
        providerKind: 'openai-compatible',
        capabilities: {
          inputModalities: ['text'],
          reasoning: true,
          reasoningEfforts: ['high'],
        },
      },
    ])

    expect(clientOptions).toEqual([{ apiKey: 'sk-codex' }])
    expect(requests).toEqual([
      { method: 'model/list', params: { includeHidden: true, limit: 100 } },
    ])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('lists Universal models from the OpenAI-compatible endpoint only', async () => {
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
