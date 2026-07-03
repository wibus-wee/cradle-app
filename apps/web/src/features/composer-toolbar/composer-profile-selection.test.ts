import { describe, expect, it } from 'vitest'

import type { RuntimeCatalogItem } from '~/features/agent-runtime/runtime-catalog'

import {
  listSelectableComposerProfiles,
  listSelectableComposerProfilesForRuntimes,
  pickComposerProfileId,
} from './composer-profile-selection'
import type { ProviderModelOption } from './types'

function provider(overrides: Partial<ProviderModelOption> & Pick<ProviderModelOption, 'id'>): ProviderModelOption {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    kind: overrides.kind ?? 'manual',
    providerKind: overrides.providerKind ?? 'openai-compatible',
    enabled: overrides.enabled ?? true,
    iconSlug: overrides.iconSlug ?? null,
  }
}

function runtime(runtimeKind: string, providerKinds: RuntimeCatalogItem['providerKinds']): RuntimeCatalogItem {
  return {
    runtimeKind,
    label: runtimeKind,
    providerKinds,
    providerBinding: 'required',
    sessionLaunchMode: 'runtime-provider',
    icon: { key: 'custom' },
    surfaces: ['chat'],
    availability: 'stable',
    composer: {
      inputMode: 'rich',
      modelSelection: 'provider-model',
      thinking: 'per-model',
    },
    slots: [],
    source: 'builtin',
    pluginOwner: null,
    capabilities: null,
  }
}

describe('listSelectableComposerProfiles', () => {
  it('hides disabled provider targets', () => {
    const profiles = [
      provider({ id: 'enabled-provider' }),
      provider({ id: 'disabled-provider', enabled: false }),
    ]

    expect(listSelectableComposerProfiles({
      profiles,
      runtimeKind: 'standard',
      runtimes: [runtime('standard', ['openai-compatible'])],
    }).map(item => item.id))
      .toEqual(['enabled-provider'])
  })

  it('keeps openai-compatible provider targets for Codex', () => {
    const profiles = [
      provider({ id: 'manual-openai-provider', kind: 'manual', providerKind: 'openai-compatible' }),
      provider({ id: 'external-openai-provider', kind: 'external', providerKind: 'openai-compatible' }),
      provider({ id: 'anthropic-provider', kind: 'external', providerKind: 'anthropic' }),
    ]

    expect(listSelectableComposerProfiles({
      profiles,
      runtimeKind: 'codex',
      runtimes: [runtime('codex', ['openai-compatible'])],
    }).map(item => item.id))
      .toEqual(['manual-openai-provider', 'external-openai-provider'])
  })

  it('keeps anthropic providers for Claude Agent', () => {
    const profiles = [
      provider({ id: 'openai-provider', providerKind: 'openai-compatible' }),
      provider({ id: 'anthropic-provider', providerKind: 'anthropic' }),
    ]

    expect(listSelectableComposerProfiles({
      profiles,
      runtimeKind: 'claude-agent',
      runtimes: [runtime('claude-agent', ['anthropic'])],
    }).map(item => item.id))
      .toEqual(['anthropic-provider'])
  })

  it('does not fall back to a hard-coded runtime provider table', () => {
    const profiles = [
      provider({ id: 'openai-provider', providerKind: 'openai-compatible' }),
    ]

    expect(listSelectableComposerProfiles({ profiles, runtimeKind: 'codex' })).toEqual([])
  })
})

describe('listSelectableComposerProfilesForRuntimes', () => {
  it('keeps provider targets compatible with any declared runtime in the set', () => {
    const profiles = [
      provider({ id: 'openai-provider', providerKind: 'openai-compatible' }),
      provider({ id: 'anthropic-provider', providerKind: 'anthropic' }),
      provider({ id: 'disabled-provider', providerKind: 'openai-compatible', enabled: false }),
    ]
    const runtimes = [
      runtime('codex', ['openai-compatible']),
      runtime('claude-agent', ['anthropic']),
      runtime('standard', ['openai-compatible']),
    ]

    expect(listSelectableComposerProfilesForRuntimes({
      profiles,
      runtimeKinds: ['codex', 'claude-agent'],
      runtimes,
    }).map(item => item.id))
      .toEqual(['openai-provider', 'anthropic-provider'])
  })
})

describe('pickComposerProfileId', () => {
  it('keeps a selectable persisted profile', () => {
    const profiles = [
      provider({ id: 'first-provider' }),
      provider({ id: 'persisted-provider', kind: 'external' }),
    ]

    expect(pickComposerProfileId({ profiles, lastProfileId: 'persisted-provider' })).toBe('persisted-provider')
  })

  it('falls back to the first selectable profile', () => {
    const profiles = [
      provider({ id: 'first-provider' }),
      provider({ id: 'second-provider' }),
    ]

    expect(pickComposerProfileId({ profiles, lastProfileId: 'missing-provider' })).toBe('first-provider')
  })
})
