export const providerKinds = ['openai-compatible', 'anthropic', 'universal'] as const

export type ProviderKind = (typeof providerKinds)[number]

export const providerTargetKinds = ['manual', 'external'] as const

export type ProviderTargetKind = (typeof providerTargetKinds)[number]

export type RuntimeKind = string

export interface ProviderRequest {
  providerKind: ProviderKind
  label: string
  configJson: string
  secretRef: string | null
  profileId: string | null
  providerTargetKind: ProviderTargetKind | null
  providerTargetId: string | null
  sourceApp: string | null
}

/**
 * A served service tier a provider declares for one model, e.g. an OpenAI
 * `priority` tier or a gateway's own faster lane. The ids are the upstream
 * wire values, because they are sent back verbatim.
 */
export interface ModelServiceTier {
  id: string
  name: string
  description?: string
}

export interface ModelCapabilities {
  contextWindow?: number
  maxOutput?: number
  inputModalities?: string[]
  outputModalities?: string[]
  reasoning?: boolean
  reasoningEfforts?: Array<'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'>
  /** Service tiers this model may be served at; empty means "only the default". */
  serviceTiers?: ModelServiceTier[]
  toolCall?: boolean
  temperature?: boolean
  structuredOutput?: boolean
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }
  family?: string
  knowledgeCutoff?: string
  releaseDate?: string
  registryMatch?: 'exact' | 'fuzzy' | 'manual' | 'alias' | 'unmatched'
  registryModelId?: string
  registryModelLabel?: string
}

export interface ModelDescriptor {
  id: string
  label: string
  providerKind: ProviderKind
  capabilities: ModelCapabilities
}
