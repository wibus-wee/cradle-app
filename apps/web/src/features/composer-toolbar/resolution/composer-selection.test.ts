import { describe, expect, it } from 'vitest'

import type { ModelDescriptor } from '~/features/agent-runtime/types'

import type { ProviderModelOption } from '../types'
import {
  readComposerThinkingEffort,
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

describe('readComposerThinkingEffort', () => {
  it('normalizes only supported effort values', () => {
    expect(readComposerThinkingEffort('xhigh')).toBe('xhigh')
    expect(readComposerThinkingEffort('ultra')).toBeNull()
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
      lastThinkingEffort: null,
    })).toEqual({
      thinkingEffort: 'xhigh',
      usesBoundSessionThinkingEffort: true,
    })
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

  it('uses persisted provider model before falling back to the first model', () => {
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
