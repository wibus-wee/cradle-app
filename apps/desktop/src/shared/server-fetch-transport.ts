export const DESKTOP_SERVER_FETCH_OPEN_CHANNEL = 'desktop-server-fetch:open'
export const DESKTOP_SERVER_FETCH_CREDIT_CHANNEL = 'desktop-server-fetch:credit'
export const DESKTOP_SERVER_FETCH_CANCEL_CHANNEL = 'desktop-server-fetch:cancel'
export const DESKTOP_SERVER_FETCH_CHUNK_CHANNEL = 'desktop-server-fetch:chunk'
export const DESKTOP_SERVER_FETCH_CLOSED_CHANNEL = 'desktop-server-fetch:closed'
export const DESKTOP_SERVER_FETCH_ERROR_CHANNEL = 'desktop-server-fetch:error'

export const DESKTOP_SERVER_FETCH_CHUNK_BYTES = 64 * 1024
export const DESKTOP_SERVER_FETCH_MAX_CREDIT = 4

export interface DesktopServerFetchRequest {
  requestId: string
  generation: number
  method: string
  path: string
  headers: Array<[string, string]>
  body: Uint8Array | null
}

export interface DesktopServerFetchResponseHead {
  requestId: string
  status: number
  statusText: string
  headers: Array<[string, string]>
  url: string
}

export interface DesktopServerFetchChunk {
  requestId: string
  bytes: Uint8Array
}

export interface DesktopServerFetchTerminalEvent {
  requestId: string
}

export interface DesktopServerFetchErrorEvent extends DesktopServerFetchTerminalEvent {
  message: string
}
