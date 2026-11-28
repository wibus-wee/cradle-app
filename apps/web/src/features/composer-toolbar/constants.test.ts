import { describe, expect, it } from 'vitest'

import type { ModelDescriptor } from '~/features/agent-runtime/types'

import {
  filterThinkingOptionsForModel,
  getThinkingCapabilityTier,
  modelSupportsFastServiceTier,
  selectSupportedThinkingValue,
  THINKING_EFFORTS,
} from './constants'

function model(overrides: Partial<ModelDescriptor> & { id: string }): ModelDescriptor {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    providerKind: overrides.providerKind ?? 'openai-compatible',
    capabilities: overrides.capabilities ?? {},
  }
}

describe('fast service tier availability', () => {
  it('offers fast mode only when the model declares the fast tier', () => {
    expect(modelSupportsFastServiceTier(model({
      id: 'codex/gpt-6.2-sol',
      capabilities: { serviceTiers: [{ id: 'priority', name: 'Fast' }] },
    }))).toBe(true)

    expect(modelSupportsFastServiceTier(model({
      id: 'opencode-go/deepseek-v4-pro',
      capabilities: { serviceTiers: [] },
    }))).toBe(false)

    // A descriptor without the field cannot prove support.
    expect(modelSupportsFastServiceTier(model({
      id: 'bare/model',
      capabilities: {},
    }))).toBe(false)

    expect(modelSupportsFastServiceTier(null)).toBe(false)
  })
})

describe('thinking capability filtering', () => {
  it('does not infer extended thinking from model names', () => {
    const options = filterThinkingOptionsForModel(
      model({
        id: 'gpt-5-codex',
        capabilities: { reasoning: true },
      }),
      THINKING_EFFORTS,
    )

    expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high'])
    expect(getThinkingCapabilityTier(model({
      id: 'gpt-5-codex',
      capabilities: { reasoning: true },
    }))).toBe('standard')
  })

  it('uses server-declared reasoning efforts for extended thinking', () => {
    const options = filterThinkingOptionsForModel(
      model({
        id: 'runtime-declared-reasoning-model',
        capabilities: {
          reasoning: true,
          reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        },
      }),
      THINKING_EFFORTS,
    )

    expect(options.map(option => option.value)).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(getThinkingCapabilityTier(model({
      id: 'runtime-declared-reasoning-model',
      capabilities: {
        reasoning: true,
        reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
    }))).toBe('extended')
  })

  it('exposes ultra only when the runtime model declares it', () => {
    const options = filterThinkingOptionsForModel(
      model({
        id: 'codex-ultra',
        capabilities: {
          reasoning: true,
          reasoningEfforts: ['low', 'medium', 'high', 'ultra'],
        },
      }),
      THINKING_EFFORTS,
    )

    expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'ultra'])
  })

  it('uses the requested fallback before the first supported effort', () => {
    expect(selectSupportedThinkingValue(
      model({
        id: 'runtime-declared-reasoning-model',
        capabilities: {
          reasoning: true,
          reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        },
      }),
      THINKING_EFFORTS,
      null,
      'high',
    )).toBe('high')
  })

  it('does not invent effort tiers when the server declared an empty list', () => {
    const options = filterThinkingOptionsForModel(
      model({
        id: 'reasoning-without-effort-slider',
        capabilities: {
          reasoning: true,
          reasoningEfforts: [],
        },
      }),
      THINKING_EFFORTS,
    )

    expect(options.map(option => option.value)).toEqual([])
    expect(getThinkingCapabilityTier(model({
      id: 'reasoning-without-effort-slider',
      capabilities: {
        reasoning: true,
        reasoningEfforts: [],
      },
    }))).toBe('none')
  })

  it('filters to the exact declared effort subset', () => {
    expect(filterThinkingOptionsForModel(
      model({
        id: 'o3',
        capabilities: {
          reasoning: true,
          reasoningEfforts: ['low', 'medium', 'high'],
        },
      }),
      THINKING_EFFORTS,
    ).map(option => option.value)).toEqual(['low', 'medium', 'high'])
  })
})
