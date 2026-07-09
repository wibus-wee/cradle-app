import type { ProviderListResponse } from '@opencode-ai/sdk'
import { describe, expect, it } from 'vitest'

import { flattenOpenCodeProviders } from './model-inventory'

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
