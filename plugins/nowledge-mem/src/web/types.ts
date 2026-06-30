/* Type contracts used by the Nowledge Mem settings panel. */

export interface NowledgePluginConfig {
  apiUrl: string
  mcpUrl?: string
  spaceId?: string
  enabled: boolean
  recallEnabled: false
  captureEnabled: false
  hasApiKey: boolean
}

export interface ConfigFormState {
  apiUrl: string
  mcpUrl: string
  spaceId: string
  enabled: boolean
}

export interface RouteOk<T> { ok: true, data: T }
export interface RouteErr { ok: false, code: string, message: string }
export type RouteResponse<T> = RouteOk<T> | RouteErr

/**
 * Health payload returned by the Nowledge Mem `/health` endpoint.
 * Treated defensively (the upstream shape is not strictly typed); we only
 * read a few well-known fields and ignore the rest.
 */
export interface NowledgeHealth {
  skipped?: boolean
  reason?: string
  status?: string
  ok?: boolean
  version?: string
  [key: string]: unknown
}

/** Response shape of the plugin's `GET /status` route. */
export interface NowledgeStatusData {
  config: NowledgePluginConfig
  health: NowledgeHealth
}

/** Coarse connection state derived from the status route. */
export type ConnState = 'loading' | 'connected' | 'unreachable' | 'disabled'
