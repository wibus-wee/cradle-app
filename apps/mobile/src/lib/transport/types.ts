export interface CradleResponseBodyReader {
  cancel: (reason?: unknown) => Promise<void>
  read: () => Promise<ReadableStreamReadResult<Uint8Array>>
  releaseLock: () => void
}

export interface CradleResponseBody {
  cancel: (reason?: unknown) => Promise<void>
  getReader: () => CradleResponseBodyReader
}

/** Fetch-compatible response surface owned by Cradle transports. */
export interface CradleResponse {
  readonly body: CradleResponseBody | null
  readonly bodyUsed: boolean
  readonly headers: Headers
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  arrayBuffer: () => Promise<ArrayBuffer>
  json: () => Promise<unknown>
  text: () => Promise<string>
}

export interface CradleTransport {
  request: (path: string, init: RequestInit) => Promise<CradleResponse>
  close?: (reason?: string) => void
  setActive?: (active: boolean) => void
}

export interface DirectServerConfig {
  url: string
  token: string | null
}

export interface DirectServerConnection extends DirectServerConfig {
  kind: 'direct'
  resourceId: string
  displayName: string
  transport: CradleTransport
}

export interface FabricNodeConnection {
  kind: 'fabric'
  resourceId: string
  displayName: string
  fabricId: string
  nodeId: string
  relayUrl: string
  transport: CradleTransport
}

export type CradleConnection = DirectServerConnection | FabricNodeConnection
