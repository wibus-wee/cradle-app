import { afterEach, describe, expect, it } from 'vitest'

import { addHostMcpServer, removeHostMcpServer } from '../../../plugins/mcp-registry'
import type { RuntimeProviderTargetProfile } from '../../chat-runtime/runtime-provider-types'
import { resolveOpencodeConfig } from './config'

function createProfile(input: Partial<RuntimeProviderTargetProfile> & {
  providerKind: RuntimeProviderTargetProfile['providerKind']
  configJson: string
}): RuntimeProviderTargetProfile {
  return {
    id: input.id ?? 'target-1',
    name: input.name ?? 'Target One',
    providerKind: input.providerKind,
    enabled: input.enabled ?? true,
    configJson: input.configJson,
    credentialRef: input.credentialRef ?? 'secret-1',
    customModels: input.customModels ?? '[]',
    iconSlug: input.iconSlug ?? null,
    providerTargetKind: input.providerTargetKind ?? 'manual',
    providerTargetId: input.providerTargetId ?? 'target-1',
  }
}

describe('resolveOpencodeConfig', () => {
  afterEach(() => {
    removeHostMcpServer('browser-use')
    removeHostMcpServer('nowledge-mem')
  })

  it('projects an OpenAI-compatible target into opencode provider config and provider/model id', async () => {
    const resolved = await resolveOpencodeConfig({
      profile: createProfile({
        providerKind: 'openai-compatible',
        configJson: JSON.stringify({
          baseUrl: 'https://openai-compatible.example.test/v1',
          model: 'upstream/gpt-5',
          enabledModels: ['upstream/gpt-5-mini'],
          modelRegistryMappings: [{
            modelId: 'gpt-5',
            registryModelId: 'openai/gpt-5',
            matchType: 'manual',
            model: {
              id: 'openai/gpt-5',
              name: 'GPT-5 Registry',
              limit: { context: 400000, output: 128000 },
              cost: { input: 1.25, output: 10, cache_read: 0.125, cache_write: 1.25 },
              reasoning: true,
              tool_call: true,
              temperature: false,
              modalities: { input: ['text', 'image'], output: ['text'] },
              release_date: '2026-01-01',
            },
          }],
        }),
        customModels: JSON.stringify([{
          id: 'upstream/custom-model',
          label: 'Custom Model',
          capabilities: {},
        }]),
      }),
      readSecret: () => 'secret-value',
    })

    expect(resolved.model).toEqual({
      providerID: 'cradle-manual-target-1',
      modelID: 'gpt-5',
    })
    expect(resolved.config.model).toBe('cradle-manual-target-1/gpt-5')
    expect(resolved.requestedModelId).toBe('upstream/gpt-5')
    expect(resolved.config.provider?.['cradle-manual-target-1']).toMatchObject({
      api: 'openai-compatible',
      npm: '@ai-sdk/openai-compatible',
      options: {
        apiKey: 'secret-value',
        baseURL: 'https://openai-compatible.example.test/v1',
        timeout: false,
      },
      models: {
        'gpt-5': {
          id: 'gpt-5',
          name: 'GPT-5 Registry',
          reasoning: true,
          tool_call: true,
          temperature: false,
          limit: { context: 400000, output: 128000 },
          cost: { input: 1.25, output: 10, cache_read: 0.125, cache_write: 1.25 },
          modalities: { input: ['text', 'image'], output: ['text'] },
          release_date: '2026-01-01',
        },
        'gpt-5-mini': {
          id: 'gpt-5-mini',
          name: 'gpt-5-mini',
        },
        'custom-model': {
          id: 'custom-model',
          name: 'Custom Model',
        },
      },
    })
  })

  it('projects OpenAI-compatible responses targets into opencode OpenAI Responses provider config', async () => {
    const resolved = await resolveOpencodeConfig({
      profile: createProfile({
        providerKind: 'openai-compatible',
        configJson: JSON.stringify({
          baseUrl: 'https://openai-compatible.example.test/v1',
          model: 'gpt-5.5',
          apiMode: 'responses',
        }),
      }),
      readSecret: () => 'secret-value',
    })

    expect(resolved.model).toEqual({
      providerID: 'cradle-manual-target-1',
      modelID: 'gpt-5.5',
    })
    expect(resolved.config.model).toBe('cradle-manual-target-1/gpt-5.5')
    expect(resolved.config.provider?.['cradle-manual-target-1']).toMatchObject({
      api: 'openai',
      npm: '@ai-sdk/openai',
      options: {
        apiKey: 'secret-value',
        baseURL: 'https://openai-compatible.example.test/v1',
        timeout: false,
      },
      models: {
        'gpt-5.5': {
          id: 'gpt-5.5',
          name: 'GPT-5.5',
        },
      },
    })
  })

  it('projects a universal anthropic model into an opencode anthropic provider config', async () => {
    const resolved = await resolveOpencodeConfig({
      profile: createProfile({
        providerKind: 'universal',
        configJson: JSON.stringify({
          openaiBaseUrl: 'https://openai-compatible.example.test/v1',
          anthropicBaseUrl: 'https://anthropic.example.test',
          model: 'anthropic/claude-sonnet-4-5',
        }),
      }),
      readSecret: () => 'secret-value',
    })

    expect(resolved.config.model).toBe('cradle-manual-target-1/claude-sonnet-4-5')
    expect(resolved.requestedModelId).toBe('anthropic/claude-sonnet-4-5')
    expect(resolved.config.provider?.['cradle-manual-target-1']).toMatchObject({
      api: 'anthropic',
      npm: '@ai-sdk/anthropic',
      options: {
        apiKey: 'secret-value',
        baseURL: 'https://anthropic.example.test',
        timeout: false,
      },
    })
  })

  it('projects Volcengine Anthropic targets into opencode authToken provider options', async () => {
    const resolved = await resolveOpencodeConfig({
      profile: createProfile({
        providerKind: 'anthropic',
        configJson: JSON.stringify({
          baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
          model: 'glm-5.2',
        }),
      }),
      readSecret: () => 'secret-value',
    })

    expect(resolved.config.model).toBe('cradle-manual-target-1/glm-5.2')
    expect(resolved.config.provider?.['cradle-manual-target-1']).toMatchObject({
      api: 'anthropic',
      npm: '@ai-sdk/anthropic',
      options: {
        authToken: 'secret-value',
        baseURL: 'https://ark.cn-beijing.volces.com/api/coding',
        timeout: false,
      },
    })
    expect(resolved.config.provider?.['cradle-manual-target-1'].options).not.toHaveProperty('apiKey')
  })

  it('projects plugin-registered MCP servers into opencode config', async () => {
    addHostMcpServer({
      transport: 'stdio',
      name: 'browser-use',
      command: 'node',
      args: ['/plugins/browser-use/dist/mcp-server.mjs'],
      env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
    })
    addHostMcpServer({
      transport: 'streamable-http',
      name: 'nowledge-mem',
      url: 'https://nowledge.example.test/mcp',
      headers: { Authorization: 'Bearer nowledge-secret' },
    })

    const resolved = await resolveOpencodeConfig({
      profile: createProfile({
        providerKind: 'openai-compatible',
        configJson: JSON.stringify({
          baseUrl: 'https://openai-compatible.example.test/v1',
          model: 'gpt-5.5',
        }),
      }),
      readSecret: () => 'secret-value',
    })

    expect(resolved.config.mcp).toEqual({
      'browser-use': {
        type: 'local',
        command: ['node', '/plugins/browser-use/dist/mcp-server.mjs'],
        environment: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
        enabled: true,
      },
      'nowledge-mem': {
        type: 'remote',
        url: 'https://nowledge.example.test/mcp',
        headers: { Authorization: 'Bearer nowledge-secret' },
        enabled: true,
      },
    })
  })
})
