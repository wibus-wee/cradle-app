import { describe, expect, it } from 'vitest'

import type { ModelDescriptor } from '~/features/agent-runtime/types'

import type { ProviderModelOption } from '../types'
import {
  readComposerThinkingEffort,
  resolveComposerCatalogSource,
  resolveComposerModelId,
  resolveComposerProfileId,
  resolvePreferredThinkingEffort,
} from './composer-selection'

function profile(overrides: Partial<ProviderModelOption> & { id: string }): ProviderModelOption {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    providerKind: overrides.providerKind ?? 'openai-compatible',
    enabled: overrides.enabled ?? true,
    iconSlug: overrides.iconSlug ?? null,
    sourceKey: overrides.sourceKey,
    externalRecordId: overrides.externalRecordId,
  }
}

function model(overrides: Partial<ModelDescriptor> & { id: string }): ModelDescriptor {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    providerKind: overrides.providerKind ?? 'openai-compatible',
    capabilities: overrides.capabilities ?? {},
  }
}

describe('resolveComposerCatalogSource', () => {
  it('uses the remote catalog when a remote host id is present', () => {
    expect(resolveComposerCatalogSource(null)).toBe('local')
    expect(resolveComposerCatalogSource(undefined)).toBe('local')
    expect(resolveComposerCatalogSource('host-1')).toBe('remote-host')
  })
})

describe('readComposerThinkingEffort', () => {
  it('normalizes only supported effort values', () => {
    expect(readComposerThinkingEffort('none')).toBe('none')
    expect(readComposerThinkingEffort('minimal')).toBe('minimal')
    expect(readComposerThinkingEffort('xhigh')).toBe('xhigh')
    expect(readComposerThinkingEffort('max')).toBe('max')
    expect(readComposerThinkingEffort('ultra')).toBe('ultra')
    expect(readComposerThinkingEffort(undefined)).toBeNull()
  })
})

describe('resolvePreferredThinkingEffort', () => {
  it('uses manual thinking effort before bound session and persisted values', () => {
    expect(resolvePreferredThinkingEffort({
      manualThinkingEffort: 'low',
      boundSessionThinkingEffort: 'high',
      boundAgentThinkingEffort: 'medium',
      selectedAgentThinkingEffort: null,
      lastModelThinkingEffort: null,
      lastProviderThinkingEffort: null,
      lastThinkingEffort: 'xhigh',
    })).toEqual({
      thinkingEffort: 'low',
      usesBoundSessionThinkingEffort: false,
    })
  })

  it('marks bound session thinking effort so model capability pruning preserves it', () => {
    expect(resolvePreferredThinkingEffort({
      manualThinkingEffort: undefined,
      boundSessionThinkingEffort: 'xhigh',
      boundAgentThinkingEffort: 'medium',
      selectedAgentThinkingEffort: null,
      lastModelThinkingEffort: 'low',
      lastProviderThinkingEffort: 'high',
      lastThinkingEffort: null,
    })).toEqual({
      thinkingEffort: 'xhigh',
      usesBoundSessionThinkingEffort: true,
    })
  })

  it('restores model, then provider, then global thinking preferences', () => {
    const base = {
      manualThinkingEffort: undefined,
      boundSessionThinkingEffort: null,
      boundAgentThinkingEffort: null,
      selectedAgentThinkingEffort: null,
      lastThinkingEffort: 'low' as const,
    }

    expect(resolvePreferredThinkingEffort({
      ...base,
      lastModelThinkingEffort: 'xhigh',
      lastProviderThinkingEffort: 'high',
    }).thinkingEffort).toBe('xhigh')
    expect(resolvePreferredThinkingEffort({
      ...base,
      lastModelThinkingEffort: null,
      lastProviderThinkingEffort: 'high',
    }).thinkingEffort).toBe('high')
    expect(resolvePreferredThinkingEffort({
      ...base,
      lastModelThinkingEffort: null,
      lastProviderThinkingEffort: null,
    }).thinkingEffort).toBe('low')
  })
})

describe('resolveComposerProfileId', () => {
  it('prefers selected agent provider target before manual provider choices', () => {
    expect(resolveComposerProfileId({
      composerUsesModelSelection: true,
      context: 'new-chat',
      targetMode: 'agent',
      selectedAgentId: 'agent-1',
      selectedAgentProviderTargetId: 'provider-agent',
      manualProfileId: 'provider-manual',
      boundAgentProviderTargetId: null,
      boundProviderTargetId: null,
      boundModelId: null,
      providerBinding: 'required',
      lastProfileId: null,
      selectableProfiles: [
        profile({ id: 'provider-agent' }),
        profile({ id: 'provider-manual' }),
      ],
    })).toBe('provider-agent')
  })

  it('restores runtime-owned chat provider from bound model metadata', () => {
    expect(resolveComposerProfileId({
      composerUsesModelSelection: true,
      context: 'chat',
      targetMode: 'provider',
      selectedAgentId: null,
      selectedAgentProviderTargetId: null,
      manualProfileId: null,
      boundAgentProviderTargetId: null,
      boundProviderTargetId: null,
      boundModelId: 'mimo/mimo-v2.5-pro-ultraspeed',
      providerBinding: 'runtime-owned',
      lastProfileId: null,
      selectableProfiles: [
        profile({ id: 'runtime-native:opencode:openai', externalRecordId: 'openai' }),
        profile({ id: 'runtime-native:opencode:mimo', externalRecordId: 'mimo' }),
      ],
    })).toBe('runtime-native:opencode:mimo')
  })

  it('returns null for agent mode before an agent is selected', () => {
    expect(resolveComposerProfileId({
      composerUsesModelSelection: true,
      context: 'new-chat',
      targetMode: 'agent',
      selectedAgentId: null,
      selectedAgentProviderTargetId: null,
      manualProfileId: 'provider-1',
      boundAgentProviderTargetId: null,
      boundProviderTargetId: null,
      boundModelId: null,
      providerBinding: 'required',
      lastProfileId: null,
      selectableProfiles: [profile({ id: 'provider-1' })],
    })).toBeNull()
  })
})

describe('resolveComposerModelId', () => {
  it('uses manual model when it belongs to the loaded model list', () => {
    expect(resolveComposerModelId({
      composerUsesModelSelection: true,
      context: 'new-chat',
      targetMode: 'provider',
      selectedAgentId: null,
      selectedAgentModelId: 'agent-model',
      manualModelId: 'manual-model',
      models: [model({ id: 'manual-model' }), model({ id: 'agent-model' })],
      boundAgentModelId: null,
      boundAgentProviderTargetId: null,
      boundModelId: null,
      boundProviderTargetId: null,
      manualProfileId: 'provider-1',
      profileId: 'provider-1',
      lastModelByProfile: {},
    })).toBe('manual-model')
  })

  it('uses persisted provider model when present in the inventory', () => {
    expect(resolveComposerModelId({
      composerUsesModelSelection: true,
      context: 'new-chat',
      targetMode: 'provider',
      selectedAgentId: null,
      selectedAgentModelId: null,
      manualModelId: null,
      models: [model({ id: 'first-model' }), model({ id: 'persisted-model' })],
      boundAgentModelId: null,
      boundAgentProviderTargetId: null,
      boundModelId: null,
      boundProviderTargetId: null,
      manualProfileId: null,
      profileId: 'provider-1',
      lastModelByProfile: { 'provider-1': 'persisted-model' },
    })).toBe('persisted-model')
  })

  it('restores a persisted provider model as an orphan when it is outside the visible inventory', () => {
    expect(resolveComposerModelId({
      composerUsesModelSelection: true,
      context: 'new-chat',
      targetMode: 'provider',
      selectedAgentId: null,
      selectedAgentModelId: null,
      manualModelId: null,
      models: [model({ id: 'first-model' })],
      boundAgentModelId: null,
      boundAgentProviderTargetId: null,
      boundModelId: null,
      boundProviderTargetId: null,
      manualProfileId: null,
      profileId: 'provider-1',
      lastModelByProfile: { 'provider-1': 'persisted-model' },
    })).toBe('persisted-model')
  })

  it('keeps an explicit manual model even when it is temporarily outside the inventory', () => {
    expect(resolveComposerModelId({
      composerUsesModelSelection: true,
      context: 'new-chat',
      targetMode: 'provider',
      selectedAgentId: null,
      selectedAgentModelId: null,
      manualModelId: 'manual-orphan',
      models: [model({ id: 'first-model' })],
      boundAgentModelId: null,
      boundAgentProviderTargetId: null,
      boundModelId: null,
      boundProviderTargetId: null,
      manualProfileId: 'provider-1',
      profileId: 'provider-1',
      lastModelByProfile: {},
    })).toBe('manual-orphan')
  })

  it('uses models[0] when the provider has no remembered model', () => {
    expect(resolveComposerModelId({
      composerUsesModelSelection: true,
      context: 'new-chat',
      targetMode: 'provider',
      selectedAgentId: null,
      selectedAgentModelId: null,
      manualModelId: null,
      models: [model({ id: 'first-model' }), model({ id: 'second-model' })],
      boundAgentModelId: null,
      boundAgentProviderTargetId: null,
      boundModelId: null,
      boundProviderTargetId: null,
      manualProfileId: null,
      profileId: 'provider-1',
      lastModelByProfile: {},
    })).toBe('first-model')
  })

  it('uses models[0] in chat when neither the session nor provider has a remembered model', () => {
    expect(resolveComposerModelId({
      composerUsesModelSelection: true,
      context: 'chat',
      targetMode: 'provider',
      selectedAgentId: null,
      selectedAgentModelId: null,
      manualModelId: null,
      models: [model({ id: 'first-model' }), model({ id: 'second-model' })],
      boundAgentModelId: null,
      boundAgentProviderTargetId: null,
      boundModelId: null,
      boundProviderTargetId: null,
      manualProfileId: 'provider-1',
      profileId: 'provider-1',
      lastModelByProfile: {},
    })).toBe('first-model')
  })

  it('delegates chat model precedence to the bound session and agent resolver', () => {
    expect(resolveComposerModelId({
      composerUsesModelSelection: true,
      context: 'chat',
      targetMode: 'provider',
      selectedAgentId: null,
      selectedAgentModelId: null,
      manualModelId: null,
      models: [model({ id: 'agent-model' }), model({ id: 'session-model' })],
      boundAgentModelId: 'agent-model',
      boundAgentProviderTargetId: 'provider-1',
      boundModelId: 'session-model',
      boundProviderTargetId: 'provider-1',
      manualProfileId: null,
      profileId: 'provider-1',
      lastModelByProfile: {},
    })).toBe('session-model')
  })
})
