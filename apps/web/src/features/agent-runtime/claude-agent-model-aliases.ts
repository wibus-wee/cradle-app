import type { ApiProviderKind } from './types'

export function supportsClaudeAgentModelAliases(providerKind: ApiProviderKind | null): boolean {
  return providerKind === 'anthropic' || providerKind === 'universal'
}
