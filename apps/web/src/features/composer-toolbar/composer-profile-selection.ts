import { runtimeSupportsProviderKind } from '~/features/agent-runtime/runtime-compatibility'
import type { RuntimeCatalogItem } from '~/features/agent-runtime/runtime-catalog'
import type { RuntimeKind } from '~/features/agent-runtime/types'

import type { ProviderModelOption } from './types'

interface SelectableProfilesInput {
  profiles: ProviderModelOption[]
  runtimeKind: RuntimeKind
  runtimes?: RuntimeCatalogItem[]
}

interface SelectableProfilesForRuntimesInput {
  profiles: ProviderModelOption[]
  runtimeKinds: RuntimeKind[]
  runtimes?: RuntimeCatalogItem[]
}

interface PickProfileInput {
  profiles: ProviderModelOption[]
  lastProfileId: string | null
}

export function listSelectableComposerProfiles({
  profiles,
  runtimeKind,
  runtimes,
}: SelectableProfilesInput): ProviderModelOption[] {
  return profiles.filter(profile =>
    profile.enabled && runtimeSupportsProviderKind(runtimeKind, profile.providerKind, runtimes))
}

export function listSelectableComposerProfilesForRuntimes({
  profiles,
  runtimeKinds,
  runtimes,
}: SelectableProfilesForRuntimesInput): ProviderModelOption[] {
  return profiles.filter(profile =>
    profile.enabled
    && runtimeKinds.some(runtimeKind => runtimeSupportsProviderKind(runtimeKind, profile.providerKind, runtimes)))
}

export function pickComposerProfileId({
  profiles,
  lastProfileId,
}: PickProfileInput): string | null {
  if (lastProfileId && profiles.some(profile => profile.id === lastProfileId)) {
    return lastProfileId
  }

  return profiles[0]?.id ?? null
}
