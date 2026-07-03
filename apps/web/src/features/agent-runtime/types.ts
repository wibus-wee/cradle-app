import type {
  GetAgentsResponse,
  GetChatRuntimesResponse,
  GetProfilesResponse,
  GetProvidersTargetsByProviderTargetIdModelsCacheResponse,
  GetProviderTargetsResponse,
} from '~/api-gen/types.gen'

export type Agent = GetAgentsResponse[number]
export type AgentProfile = GetProfilesResponse[number]
export type ProviderTargetRecord = GetProviderTargetsResponse[number]
export type ChatRuntimeCatalogItem = GetChatRuntimesResponse['items'][number]

export type ProviderKind = ProviderTargetRecord['providerKind'] | 'cli-tool'
export type ApiProviderKind = Exclude<ProviderKind, 'cli-tool'>
export type ProviderTargetKind = ProviderTargetRecord['kind']

export type RuntimeKind = string

export interface ProviderTarget {
  kind?: ProviderTargetKind
  id: string
}

export interface CliTuiLaunchConfig {
  preset?: string
  executable: string
  args?: string[]
  env?: Record<string, string>
}

export interface AgentRuntimeConfig {
  systemPrompt?: string
  cliTui?: CliTuiLaunchConfig
  [key: string]: unknown
}

export type ModelDescriptor = GetProvidersTargetsByProviderTargetIdModelsCacheResponse['models'][number]
export type ModelCapabilities = ModelDescriptor['capabilities']
