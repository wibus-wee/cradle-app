import { describe, expect, it } from 'vitest'

import type { ModelDescriptor } from '~/features/agent-runtime/types'

import { filterThinkingOptionsForModel, getThinkingCapabilityTier, selectSupportedThinkingValue, THINKING_EFFORTS } from './constants'

function model(overrides: Partial<ModelDescriptor> & { id: string }): ModelDescriptor {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    providerKind: overrides.providerKind ?? 'openai-compatible',
    capabilities: overrides.capabilities ?? {},
  }
}

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
})
