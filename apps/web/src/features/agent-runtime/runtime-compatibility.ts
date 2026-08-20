import type { ProviderKind, RuntimeKind } from '~/features/agent-runtime/types'

import type { RuntimeCatalogItem } from './use-runtime-catalog'

export function runtimeSupportsProviderKind(
  runtimeKind: RuntimeKind,
  providerKind: ProviderKind,
  runtimes?: RuntimeCatalogItem[],
): boolean {
  const runtime = runtimes?.find(item => item.runtimeKind === runtimeKind)
  return runtime?.providerKinds.includes(providerKind) ?? false
}

export function runtimeSupportsAnyProviderKind(
  runtimeKind: RuntimeKind,
  providerKinds: ProviderKind[] | undefined,
  runtimes?: RuntimeCatalogItem[],
): boolean {
  if (!providerKinds) {
    return false
  }
  const runtime = runtimes?.find(item => item.runtimeKind === runtimeKind)
  return runtime?.providerKinds.some(providerKind => providerKinds.includes(providerKind)) ?? false
}
