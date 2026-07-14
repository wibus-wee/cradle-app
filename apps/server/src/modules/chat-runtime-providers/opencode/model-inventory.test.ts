import type { ProviderListResponse } from '@opencode-ai/sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  flattenOpenCodeProviders,
  listOpencodeCliModels,
  listOpencodeRuntimeModels,
  parseOpenCodeCliModelsOutput,
} from './model-inventory'
import type { OpencodeRuntimeResource } from './runtime-context'

describe('flattenOpenCodeProviders', () => {
  it('projects opencode reasoning efforts from variant metadata', () => {
    const providers = [{
      api: 'openai',
      name: 'OpenAI',
      env: [],
      id: 'openai',
      models: {
        'gpt-5': {
          id: 'gpt-5',
          name: 'GPT-5',
          release_date: '2026-01-01',
          attachment: false,
          reasoning: true,
          temperature: false,
          tool_call: true,
          limit: { context: 400000, output: 128000 },
          modalities: { input: ['text'], output: ['text'] },
          options: {},
          variants: {
            none: { reasoningEffort: 'none' },
            minimal: { reasoningEffort: 'minimal' },
            direct: { reasoningEffort: 'low' },
            snake: { reasoning_effort: 'medium' },
            effort: { effort: 'high' },
            thinking: { thinkingConfig: { thinkingLevel: 'xhigh' } },
            max: { reasoningConfig: { maxReasoningEffort: 'max' } },
            reasoning: { reasoning: { effort: 'high' } },
            reasoningConfig: { reasoningConfig: { maxReasoningEffort: 'medium' } },
          },
        },
      },
    }] as unknown as ProviderListResponse['all']

    expect(flattenOpenCodeProviders({
      runtimeKind: 'opencode',
      providers,
    })[0]?.capabilities).toMatchObject({
      reasoning: true,
      reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    })
  })

  it('falls back to the opencode variant key for reasoning-shaped variants', () => {
    const providers = [{
      api: 'openai',
      name: 'OpenAI',
      env: [],
      id: 'openai',
      models: {
        'gpt-5': {
          id: 'gpt-5',
          name: 'GPT-5',
          release_date: '2026-01-01',
          attachment: false,
          reasoning: true,
          temperature: false,
          tool_call: true,
          limit: { context: 400000, output: 128000 },
          modalities: { input: ['text'], output: ['text'] },
          options: {},
          variants: {
            none: {},
            minimal: { reasoning: {} },
            low: {},
            high: { reasoning: {} },
            xhigh: { thinking: true },
            max: { thinkingConfig: {} },
            decorative: { label: 'Decorative' },
          },
        },
      },
    }] as unknown as ProviderListResponse['all']

    expect(flattenOpenCodeProviders({
      runtimeKind: 'opencode',
      providers,
    })[0]?.capabilities).toMatchObject({
      reasoning: true,
      reasoningEfforts: ['none', 'minimal', 'low', 'high', 'xhigh', 'max'],
    })
  })

  it('does not invent reasoning efforts when OpenCode exposes no variants', () => {
    const providers = [{
      api: 'openai',
      name: 'OpenAI',
      env: [],
      id: 'openai',
      models: {
        'gpt-5': {
          id: 'gpt-5',
          name: 'GPT-5',
          release_date: '2026-01-01',
          attachment: false,
          reasoning: true,
          temperature: false,
          tool_call: true,
          limit: { context: 400000, output: 128000 },
          modalities: { input: ['text'], output: ['text'] },
          options: {},
        },
      },
    }] satisfies ProviderListResponse['all']

    expect(flattenOpenCodeProviders({
      runtimeKind: 'opencode',
      providers,
    })[0]?.capabilities).toMatchObject({
      reasoning: true,
    })
    expect(flattenOpenCodeProviders({
      runtimeKind: 'opencode',
      providers,
    })[0]?.capabilities.reasoningEfforts).toBeUndefined()
  })
})

describe('openCode CLI model discovery', () => {
  it('parses line-oriented slugs and projects verbose JSON metadata', () => {
    expect(parseOpenCodeCliModelsOutput([
      'openai/gpt-5',
      '{',
      '  "name": "GPT-5 Native",',
      '  "reasoning": true,',
      '  "limit": { "context": 400000, "output": 128000 },',
      '  "variants": { "high": { "reasoningEffort": "high" } }',
      '}',
      'anthropic/claude-sonnet-4-5',
    ].join('\n'))).toEqual([
      expect.objectContaining({
        slug: 'anthropic/claude-sonnet-4-5',
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
      }),
      expect.objectContaining({
        slug: 'openai/gpt-5',
        providerId: 'openai',
        label: 'GPT-5 Native',
        capabilities: expect.objectContaining({
          contextWindow: 400000,
          maxOutput: 128000,
          reasoning: true,
          reasoningEfforts: ['high'],
        }),
      }),
    ])
  })

  it('falls back without --verbose only when the verbose flag is unsupported', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'Error: unknown option: verbose',
        code: 1,
      })
      .mockResolvedValueOnce({
        stdout: 'openai/gpt-5\n',
        stderr: '',
        code: 0,
      })

    await expect(listOpencodeCliModels({
      binaryPath: '/opt/opencode',
      cwd: '/workspace/project',
    }, runCommand)).resolves.toEqual([
      expect.objectContaining({ slug: 'openai/gpt-5' }),
    ])
    expect(runCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({
      args: ['models', '--verbose'],
      cwd: '/workspace/project',
    }))
    expect(runCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
      args: ['models'],
      cwd: '/workspace/project',
    }))
  })

  it('does not hide ordinary verbose command failures behind a fallback', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'authentication failed',
      code: 1,
    })

    await expect(listOpencodeCliModels({
      binaryPath: 'opencode',
      cwd: '/workspace/project',
    }, runCommand)).rejects.toThrow('authentication failed')
    expect(runCommand).toHaveBeenCalledOnce()
  })
})

describe('openCode SDK and CLI inventory merge', () => {
  it('returns CLI-only models when SDK discovery fails', async () => {
    const catalog = await listOpencodeRuntimeModels({
      runtimeKind: 'opencode',
      workspacePath: '/workspace/project',
    }, {
      acquireRuntimeResource: vi.fn(async () => {
        throw new Error('SDK host unavailable')
      }),
      listCliModels: vi.fn(async () => parseOpenCodeCliModelsOutput('openrouter/qwen/qwen3-coder\n')),
      now: () => 123,
    })

    expect(catalog).toEqual({
      runtimeKind: 'opencode',
      source: 'opencode-cli',
      fetchedAt: 123,
      models: [expect.objectContaining({
        id: 'openrouter/qwen/qwen3-coder',
        nativeProviderId: 'openrouter',
        source: 'opencode-cli',
      })],
    })
  })

  it('keeps CLI models when the successful SDK inventory has no connected providers', async () => {
    const acquireRuntimeResource = createInventoryLease({
      ...providerInventory([createProvider('openai', 'OpenAI', 'gpt-5')]),
      connected: [],
    })
    const catalog = await listOpencodeRuntimeModels({
      runtimeKind: 'opencode',
      workspacePath: '/workspace/project',
    }, {
      acquireRuntimeResource,
      listCliModels: vi.fn(async () => parseOpenCodeCliModelsOutput([
        'openai/gpt-5',
        'local/llama-3',
      ].join('\n'))),
    })

    expect(acquireRuntimeResource).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/workspace/project',
    }))
    expect(catalog.models).toEqual([
      expect.objectContaining({ id: 'openai/gpt-5', nativeProviderId: 'openai', source: 'opencode-cli' }),
      expect.objectContaining({ id: 'local/llama-3', nativeProviderId: 'local', source: 'opencode-cli' }),
    ])
  })

  it('prefers the SDK descriptor for duplicate connected models while retaining CLI-only models', async () => {
    const catalog = await listOpencodeRuntimeModels({ runtimeKind: 'opencode' }, {
      acquireRuntimeResource: createInventoryLease(providerInventory([
        createProvider('openai', 'OpenAI', 'gpt-5'),
      ], ['openai'])),
      listCliModels: vi.fn(async () => parseOpenCodeCliModelsOutput([
        'openai/gpt-5',
        'local/llama-3',
      ].join('\n'))),
    })

    expect(catalog.models.find(model => model.id === 'openai/gpt-5')).toMatchObject({
      label: 'SDK gpt-5',
      source: 'opencode-sdk',
      nativeProviderId: 'openai',
    })
    expect(catalog.models.find(model => model.id === 'local/llama-3')).toMatchObject({
      source: 'opencode-cli',
      nativeProviderId: 'local',
    })
  })

  it('canonicalizes nested SDK model ids before merging with CLI descriptors', async () => {
    const catalog = await listOpencodeRuntimeModels({ runtimeKind: 'opencode' }, {
      acquireRuntimeResource: createInventoryLease(providerInventory([
        createProvider('openrouter', 'OpenRouter', 'qwen/qwen3-coder'),
      ], ['openrouter'])),
      listCliModels: vi.fn(async () => parseOpenCodeCliModelsOutput('openrouter/qwen/qwen3-coder\n')),
    })

    expect(catalog.models).toEqual([
      expect.objectContaining({
        id: 'openrouter/qwen/qwen3-coder',
        label: 'SDK qwen/qwen3-coder',
        source: 'opencode-sdk',
        nativeProviderId: 'openrouter',
      }),
    ])
  })

  it('reports both root causes when SDK and CLI discovery fail', async () => {
    await expect(listOpencodeRuntimeModels({ runtimeKind: 'opencode' }, {
      acquireRuntimeResource: vi.fn(async () => {
        throw new Error('SDK exploded')
      }),
      listCliModels: vi.fn(async () => {
        throw new Error('CLI exploded')
      }),
    })).rejects.toThrow([
      'OpenCode model discovery failed.',
      'SDK provider.list: SDK exploded',
      'CLI models: CLI exploded',
    ].join('\n'))
  })
})

function createProvider(id: string, name: string, modelId: string): ProviderListResponse['all'][number] {
  return {
    api: 'openai',
    name,
    env: [],
    id,
    models: {
      [modelId]: {
        id: modelId,
        name: `SDK ${modelId}`,
        release_date: '2026-01-01',
        attachment: false,
        reasoning: true,
        temperature: false,
        tool_call: true,
        limit: { context: 400000, output: 128000 },
        modalities: { input: ['text'], output: ['text'] },
        options: {},
      },
    },
  }
}

function providerInventory(
  providers: ProviderListResponse['all'],
  connected: string[] = [],
): ProviderListResponse {
  return { all: providers, connected, default: {} }
}

function createInventoryLease(inventory: ProviderListResponse) {
  return vi.fn(async () => ({
    resource: {
      client: {
        provider: {
          list: vi.fn(async () => ({ data: inventory })),
        },
      },
    } as unknown as OpencodeRuntimeResource,
    refresh: vi.fn(),
    release: vi.fn(),
  }))
}
