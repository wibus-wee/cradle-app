import type { ModelDescriptor, ProviderKind, ProviderTargetKind, RuntimeKind } from '~/features/agent-runtime/types'

export type ComposerContext = 'new-chat' | 'chat'
export type ComposerTargetMode = 'provider' | 'agent'
export type RuntimeProviderBinding = 'required' | 'runtime-owned'

export type ThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null

export interface ComposerSelection {
  agentId: string | null
  profileId: string | null
  modelId: string | null
  thinkingEffort: ThinkingEffort
  runtimeKind: RuntimeKind
  targetMode: ComposerTargetMode
}

export interface ProviderModelOption {
  id: string
  kind?: ProviderTargetKind
  name: string
  providerKind: ProviderKind
  enabled: boolean
  iconSlug: string | null
  sourceKey?: string | null
  externalRecordId?: string | null
}

export type ModelsByProfileId = Record<string, ModelDescriptor[]>
