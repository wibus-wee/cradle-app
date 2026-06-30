import { describe, expect, it } from 'vitest'

import { projectProviderModelCapabilities } from './model-capabilities'

describe('projectProviderModelCapabilities', () => {
  it('adds Anthropic default image input capabilities when upstream metadata is empty', () => {
    expect(projectProviderModelCapabilities({
      id: 'claude-3-haiku-20240307',
      label: 'Claude 3 Haiku',
      providerKind: 'anthropic',
      capabilities: {},
    })).toEqual({
      id: 'claude-3-haiku-20240307',
      label: 'Claude 3 Haiku',
      providerKind: 'anthropic',
      capabilities: {
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
      },
    })
  })

  it('keeps explicit Anthropic modality metadata from registry or manual overrides', () => {
    expect(projectProviderModelCapabilities({
      id: 'claude-text-only',
      label: 'Claude Text Only',
      providerKind: 'anthropic',
      capabilities: {
        inputModalities: ['text'],
        outputModalities: ['text', 'json'],
      },
    }).capabilities).toEqual({
      inputModalities: ['text'],
      outputModalities: ['text', 'json'],
    })
  })

  it('does not add image capabilities to OpenAI-compatible models', () => {
    expect(projectProviderModelCapabilities({
      id: 'text-model',
      label: 'Text Model',
      providerKind: 'openai-compatible',
      capabilities: {},
    }).capabilities).toEqual({})
  })

  it('projects Codex app-server reasoning efforts for OpenAI reasoning models', () => {
    expect(projectProviderModelCapabilities({
      id: 'gpt-5-codex',
      label: 'GPT-5 Codex',
      providerKind: 'openai-compatible',
      capabilities: {},
    }).capabilities).toEqual({
      reasoning: true,
      reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    })
  })

  it('projects Claude Agent SDK reasoning efforts for supported Claude models', () => {
    expect(projectProviderModelCapabilities({
      id: 'claude-sonnet-4-20250514',
      label: 'Claude Sonnet 4',
      providerKind: 'anthropic',
      capabilities: {},
    }).capabilities).toEqual({
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    })
  })
})
