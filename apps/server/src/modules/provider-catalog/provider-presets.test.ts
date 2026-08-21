import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelsDevData } from '../model-registry/model-info-registry'
import { fetchModelsDevData } from '../model-registry/model-info-registry'
import { collectProviderPresets } from './provider-presets'

vi.mock('../model-registry/model-info-registry', async (importOriginal) => {
  const original = await importOriginal<typeof import('../model-registry/model-info-registry')>()
  return {
    ...original,
    fetchModelsDevData: vi.fn(),
  }
})

const fetchModelsDevDataMock = vi.mocked(fetchModelsDevData)

function createModelsDevStub(): ModelsDevData {
  return {
    'deepseek': {
      name: 'DeepSeek',
      api: 'https://api.deepseek.com',
      npm: '@ai-sdk/openai-compatible',
      env: ['DEEPSEEK_API_KEY'],
      doc: 'https://api-docs.deepseek.com/quick_start/pricing',
      models: {
        'deepseek-v4-flash': {
          id: 'deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          reasoning: true,
          tool_call: true,
          modalities: { input: ['text'], output: ['text'] },
        },
      },
    },
    'groq': {
      name: 'Groq',
      npm: '@ai-sdk/groq',
      env: ['GROQ_API_KEY'],
      doc: 'https://console.groq.com/docs/models',
      models: {
        'llama-3.3-70b-versatile': {
          id: 'llama-3.3-70b-versatile',
          name: 'Llama 3.3 70B Versatile',
          tool_call: true,
          modalities: { input: ['text'], output: ['text'] },
        },
      },
    },
    'no-api-vendor': {
      name: 'No API Vendor',
      models: {
        'no-api-1': { id: 'no-api-1' },
      },
    },
    'acme-ai': {
      name: 'Acme AI',
      api: 'https://api.acme.test/v1',
      npm: '@ai-sdk/openai-compatible',
      env: ['ACME_API_KEY'],
      models: {
        'acme-vision-1': {
          id: 'acme-vision-1',
          name: 'Acme Vision 1',
          reasoning: true,
          tool_call: true,
          modalities: { input: ['text', 'image'], output: ['text'] },
        },
      },
    },
    'openrouter': {
      name: 'OpenRouter',
      api: 'https://openrouter.ai/api/v1',
      npm: '@ai-sdk/openai-compatible',
      models: {
        'anthropic/claude-sonnet-4': {
          id: 'anthropic/claude-sonnet-4',
          name: 'Claude Sonnet 4',
        },
        'openai/gpt-5': {
          id: 'openai/gpt-5',
          name: 'GPT-5',
        },
      },
    },
  }
}

describe('collectProviderPresets', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges models.dev data with the overlay, keeping overlay values on conflicts', async () => {
    fetchModelsDevDataMock.mockResolvedValue(createModelsDevStub())

    const presets = await collectProviderPresets()
    const byId = new Map(presets.map(preset => [preset.id, preset]))

    const deepseek = byId.get('deepseek')
    expect(deepseek).toBeDefined()
    expect(deepseek?.source).toBe('overlay')
    // Contribution wins WireShape: dual-endpoint vendors are universal.
    expect(deepseek?.providerKind).toBe('universal')
    expect(deepseek?.providerId).toBe('deepseek')
    expect(deepseek?.tier).toBe('first-class')
    expect(deepseek?.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(deepseek?.endpointProfiles).toEqual([
      {
        id: 'openai',
        label: 'OpenAI-compatible endpoint',
        wireKind: 'openai-compatible',
        defaultBaseUrl: 'https://api.deepseek.com/v1',
      },
      {
        id: 'anthropic',
        label: 'Anthropic-compatible endpoint',
        wireKind: 'anthropic',
        defaultBaseUrl: 'https://api.deepseek.com/anthropic',
      },
    ])
    expect(deepseek?.authMethods).toEqual([{ id: 'apiKey', label: 'API Key' }])
    expect(deepseek?.iconSlug).toBe('deepseek')
    // defaultModels carried over, enriched with models.dev names and capabilities.
    expect(deepseek?.models.map(model => model.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
    ])
    expect(deepseek?.models[0]).toEqual({
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      reasoning: true,
      toolCall: true,
    })

    const openai = byId.get('openai')
    expect(openai).toMatchObject({
      providerId: 'openai',
      source: 'builtin',
      tier: 'first-class',
      featured: true,
    })
    expect(openai?.authMethods.map(method => method.id)).toEqual([
      'apikey',
      'chatgptAuthTokens',
      'personalAccessToken',
      'bedrockApiKey',
    ])

    // Overlay-only vendors (missing from models.dev) are still present.
    const ollama = byId.get('ollama')
    expect(ollama).toMatchObject({
      baseUrl: 'http://localhost:11434/v1',
      local: true,
      requiresApiKey: false,
      source: 'overlay',
      providerId: 'ollama',
      tier: 'first-class',
    })
    const volcengine = byId.get('volcengine-ark-coding')
    expect(volcengine).toMatchObject({
      providerKind: 'anthropic',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
      source: 'overlay',
      providerId: 'volcengine-ark-coding',
    })
    expect(volcengine?.models).toEqual([{ id: 'glm-5.2' }])

    // Groq has no api in models.dev but the overlay claims it by id and supplies the base URL.
    // Its discoverable model directory stays out of the preset's user-owned model inventory.
    const groq = byId.get('groq')
    expect(groq).toMatchObject({
      baseUrl: 'https://api.groq.com/openai/v1',
      source: 'overlay',
      providerId: 'groq',
    })
    expect(groq?.models).toEqual([])

    // models.dev providers without an api base URL and without an overlay claim are excluded.
    expect(byId.has('no-api-vendor')).toBe(false)

    // Plain models.dev providers pass through with generic contribution (apiKey only).
    const acme = byId.get('acme-ai')
    expect(acme).toMatchObject({
      name: 'Acme AI',
      baseUrl: 'https://api.acme.test/v1',
      providerKind: 'openai-compatible',
      local: false,
      requiresApiKey: true,
      source: 'models.dev',
      providerId: 'acme-ai',
      tier: 'generic',
    })
    expect(acme?.authMethods).toEqual([{ id: 'apiKey', label: 'API Key' }])
    expect(acme?.models).toEqual([])

    // A provider's complete models.dev directory is not setup metadata. In
    // particular, OpenRouter's large catalog must be discovered live instead
    // of being copied into the user's custom-model list.
    expect(byId.get('openrouter')?.models).toEqual([])
  })

  it('falls back to overlay-only presets when models.dev data is unavailable', async () => {
    fetchModelsDevDataMock.mockResolvedValue(null)

    const presets = await collectProviderPresets()

    expect(presets.length).toBeGreaterThan(0)
    expect(presets.every(preset => preset.source === 'overlay' || preset.source === 'builtin')).toBe(true)
    const deepseek = presets.find(preset => preset.id === 'deepseek')
    expect(deepseek?.models.map(model => model.id)).toContain('deepseek-v4-flash')
    expect(deepseek?.providerKind).toBe('universal')
  })
})
