export type NowledgeApiKeySource = 'plugin' | 'environment' | 'none'

export interface NowledgePluginConfig {
  mcpUrl: string
  enabled: boolean
  hasApiKey: boolean
  apiKeySource: NowledgeApiKeySource
}

export interface NowledgeConfigUpdate {
  mcpUrl?: string
  enabled?: boolean
  apiKey?: string | null
}

export interface ConfigFormState {
  mcpUrl: string
  enabled: boolean
  apiKey: string
  removeApiKey: boolean
}

export interface RouteOk<T> { ok: true, data: T }
export interface RouteErr { ok: false, code: string, message: string }
export type RouteResponse<T> = RouteOk<T> | RouteErr
