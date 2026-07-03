import { describe, expect, it } from 'vitest'

import type { ModelDescriptor } from '~/features/agent-runtime/types'

import { resolveChatModelId, resolveRuntimeOwnedChatProfileId, selectChatThinkingEffort } from './resolution/chat-selection'

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

describe('resolveRuntimeOwnedChatProfileId', () => {
  it('restores a runtime-owned provider from persisted provider/model id metadata', () => {
    expect(resolveRuntimeOwnedChatProfileId({
      boundModelId: 'mimo/mimo-v2.5-pro-ultraspeed',
      providerBinding: 'runtime-owned',
      profiles: [
        {
          id: 'runtime-native:opencode:openai',
          name: 'OpenCode / OpenAI',
          providerKind: 'openai-compatible',
          enabled: true,
          iconSlug: 'opencode',
          sourceKey: 'runtime-native:opencode',
          externalRecordId: 'openai',
        },
        {
          id: 'runtime-native:opencode:mimo',
          name: 'OpenCode / Mimo',
          providerKind: 'openai-compatible',
          enabled: true,
          iconSlug: 'opencode',
          sourceKey: 'runtime-native:opencode',
          externalRecordId: 'mimo',
        },
      ],
    })).toBe('runtime-native:opencode:mimo')
  })

  it('does not project normal provider-bound runtimes', () => {
    expect(resolveRuntimeOwnedChatProfileId({
      boundModelId: 'openai/gpt-5',
      providerBinding: 'required',
      profiles: [
        {
          id: 'runtime-native:opencode:openai',
          name: 'OpenCode / OpenAI',
          providerKind: 'openai-compatible',
          enabled: true,
          iconSlug: 'opencode',
          sourceKey: 'runtime-native:opencode',
          externalRecordId: 'openai',
        },
      ],
    })).toBeNull()
  })
})

describe('selectChatThinkingEffort', () => {
  it('drops unsupported bound agent thinking effort for non-reasoning models', () => {
    expect(selectChatThinkingEffort({
      effectiveModel: model({ id: 'plain-model', capabilities: { reasoning: false } }),
      preferredThinkingEffort: 'xhigh',
    })).toBeNull()
  })

  it('keeps the preferred runtime-declared effort even when the model is unresolved', () => {
    expect(selectChatThinkingEffort({
      effectiveModel: null,
      preferredThinkingEffort: 'xhigh',
      runtimeComposer: {
        inputMode: 'rich',
        modelSelection: 'alias-matrix',
        thinking: { efforts: ['low', 'medium', 'high', 'xhigh'] },
      },
    })).toBe('xhigh')
  })

  it('falls back to high when the runtime declares high as a supported effort', () => {
    expect(selectChatThinkingEffort({
      effectiveModel: null,
      preferredThinkingEffort: null,
      runtimeComposer: {
        inputMode: 'rich',
        modelSelection: 'alias-matrix',
        thinking: { efforts: ['low', 'medium', 'high', 'xhigh'] },
      },
    })).toBe('high')
  })

  it('keeps the explicit session effort even when model capabilities do not list it', () => {
    expect(selectChatThinkingEffort({
      effectiveModel: model({
        id: 'limited-model',
        capabilities: {
          reasoning: true,
          reasoningEfforts: ['low', 'medium'],
        },
      }),
      preferredThinkingEffort: 'xhigh',
      preservePreferredThinkingEffort: true,
    })).toBe('xhigh')
  })
})
