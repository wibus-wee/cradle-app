/**
 * Provider setup contribution contracts.
 *
 * `ProviderKind` is WireShape only (protocol). `ProviderId` is integration
 * identity and must only be written on explicit user choice — never inferred
 * from hostname matching.
 */

import type { ProviderKind } from './types'

/** Stable integration identity (e.g. 'openai', 'deepseek'). Not WireShape. */
export type ProviderId = string

export type ProviderTier = 'first-class' | 'generic'

export type ProviderAuthField = 'apiKey' | 'baseUrl' | 'openaiBaseUrl' | 'anthropicBaseUrl' | 'bedrockRegion'

export interface ProviderIdentity {
  id: ProviderId
  name: string
  tagline?: string
  iconSlug?: string
  docsUrl?: string
  featured?: boolean
  local?: boolean
  tier: ProviderTier
}

export interface ProviderEndpointProfile {
  id: string
  label: string
  wireKind: ProviderKind
  defaultBaseUrl?: string
  optional?: boolean
}

export interface ProviderAuthMethodDeclaration {
  id: string
  label: string
  fields: ProviderAuthField[]
  /** Resolved by provider-auth drivers (e.g. 'codex-chatgpt'). */
  loginDriverId?: string
}

export interface ProviderSetupContribution {
  identity: ProviderIdentity
  endpointProfiles: ProviderEndpointProfile[]
  authMethods: ProviderAuthMethodDeclaration[]
  defaultAuthMethodId: string
  /** Default WireShape when creating a target from this contribution. */
  defaultWireKind: ProviderKind
  requiresApiKey?: boolean
}
