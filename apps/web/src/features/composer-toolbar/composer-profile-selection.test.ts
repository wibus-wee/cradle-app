import { describe, expect, it } from 'vitest'

import { listSelectableComposerProfiles, pickComposerProfileId } from './composer-profile-selection'
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

describe('listSelectableComposerProfiles', () => {
  it('hides disabled provider targets', () => {
    const profiles = [
      provider({ id: 'enabled-provider' }),
      provider({ id: 'disabled-provider', enabled: false }),
    ]

    expect(listSelectableComposerProfiles({ profiles, runtimeKind: 'standard' }).map(item => item.id))
      .toEqual(['enabled-provider'])
  })

  it('keeps openai-compatible provider targets for Codex', () => {
    const profiles = [
      provider({ id: 'manual-openai-provider', kind: 'manual', providerKind: 'openai-compatible' }),
      provider({ id: 'external-openai-provider', kind: 'external', providerKind: 'openai-compatible' }),
      provider({ id: 'anthropic-provider', kind: 'external', providerKind: 'anthropic' }),
    ]

    expect(listSelectableComposerProfiles({ profiles, runtimeKind: 'codex' }).map(item => item.id))
      .toEqual(['manual-openai-provider', 'external-openai-provider'])
  })

  it('keeps anthropic providers for Claude Agent', () => {
    const profiles = [
      provider({ id: 'openai-provider', providerKind: 'openai-compatible' }),
      provider({ id: 'anthropic-provider', providerKind: 'anthropic' }),
    ]

    expect(listSelectableComposerProfiles({ profiles, runtimeKind: 'claude-agent' }).map(item => item.id))
      .toEqual(['anthropic-provider'])
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
