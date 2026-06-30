import { describe, expect, it } from 'vitest'

import type { ModelDescriptor } from '~/features/agent-runtime/types'

import { resolveChatModelId, selectChatThinkingEffort } from './use-composer-state'

function model(overrides: Partial<ModelDescriptor> & { id: string }): ModelDescriptor {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    providerKind: overrides.providerKind ?? 'openai-compatible',
    capabilities: overrides.capabilities ?? {},
  }
}

describe('resolveChatModelId', () => {
  it('does not treat a missing bound agent model as a resolved chat model', () => {
    expect(resolveChatModelId({
      boundAgentModelId: 'old-model',
      boundAgentProviderTargetId: 'provider-1',
      boundModelId: null,
      boundProviderTargetId: 'provider-1',
      manualProfileId: null,
      models: [model({ id: 'current-model' })],
    })).toBe('current-model')
  })

  it('falls back to first model when boundModelId is not in models list', () => {
    expect(resolveChatModelId({
      boundAgentModelId: null,
      boundAgentProviderTargetId: null,
      boundModelId: 'opus-4.7',
      boundProviderTargetId: 'provider-a',
      manualProfileId: null,
      models: [model({ id: 'sonnet-4.6' }), model({ id: 'haiku-4.5' })],
    })).toBe('sonnet-4.6')
  })

  it('returns boundModelId when it exists in models list', () => {
    expect(resolveChatModelId({
      boundAgentModelId: null,
      boundAgentProviderTargetId: null,
      boundModelId: 'opus-4.7',
      boundProviderTargetId: 'provider-a',
      manualProfileId: null,
      models: [model({ id: 'opus-4.7' }), model({ id: 'sonnet-4.6' })],
    })).toBe('opus-4.7')
  })

  it('prefers the session model over the bound agent default model', () => {
    expect(resolveChatModelId({
      boundAgentModelId: 'codex-auto-review',
      boundAgentProviderTargetId: 'provider-a',
      boundModelId: 'gpt-5.5',
      boundProviderTargetId: 'provider-a',
      manualProfileId: null,
      models: [
        model({ id: 'codex-auto-review' }),
        model({ id: 'gpt-5.5' }),
      ],
    })).toBe('gpt-5.5')
  })
})

describe('selectChatThinkingEffort', () => {
  it('drops unsupported bound agent thinking effort for non-reasoning models', () => {
    expect(selectChatThinkingEffort({
      effectiveModel: model({ id: 'plain-model', capabilities: { reasoning: false } }),
      preferredThinkingEffort: 'xhigh',
    })).toBeNull()
  })

  it('keeps the preferred effort for claude-agent even when the model is unresolved', () => {
    // Claude Agent owns effort support at the runtime layer, so a missing model
    // descriptor must not clamp the selected effort to null.
    expect(selectChatThinkingEffort({
      effectiveModel: null,
      preferredThinkingEffort: 'xhigh',
      runtimeKind: 'claude-agent',
    })).toBe('xhigh')
  })

  it('falls back to high for claude-agent when the preferred effort is unset', () => {
    expect(selectChatThinkingEffort({
      effectiveModel: null,
      preferredThinkingEffort: null,
      runtimeKind: 'claude-agent',
    })).toBe('high')
  })
})
