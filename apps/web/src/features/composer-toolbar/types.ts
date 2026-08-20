import type { ModelDescriptor, ProviderKind, ProviderTargetKind, RuntimeKind } from '~/features/agent-runtime/types'

export type ComposerContext = 'new-chat' | 'chat'
export type ComposerTargetMode = 'provider' | 'agent' | 'acp-agent'
export type RuntimeProviderBinding = 'required' | 'runtime-owned' | 'none'

export type ThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | null

export interface ComposerSelection {
  agentId: string | null
  acpAgentId: string | null
  acpDraftSessionId: string | null
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
  effectiveProviderKinds: ProviderKind[]
  enabled: boolean
  iconSlug: string | null
  enabledModelsJson?: string
  sourceKey?: string | null
  externalRecordId?: string | null
}

export type ModelsByProfileId = Record<string, ModelDescriptor[]>
