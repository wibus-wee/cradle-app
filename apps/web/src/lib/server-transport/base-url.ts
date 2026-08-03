import {
  getConfiguredServerUrl,
  resetRuntimeServerUrlForTests,
  setRuntimeServerUrl,
} from '../server-endpoint-preferences'

/** Privileged custom scheme served by Electron `protocol.handle` (Main undici proxy). */
export const CRADLE_SERVER_LOCAL_BASE = 'cradle-server://local' as const

export type DesktopServerConnectionKind = 'owned-proxy' | 'attached-http'

/**
 * Forward-compatible Desktop ready connection projection.
 * Absent on older Desktop builds — Web falls back to HTTP(S) `serverUrl`.
 *
 * WebSocket clients always use `serverUrl` via `getServerNetworkUrl()`;
 * there is no separate `wsBaseUrl` in v1.
 */
export type DesktopServerConnectionProjection
  = | {
    kind: 'owned-proxy'
    serverUrl: string
    rendererBaseUrl: typeof CRADLE_SERVER_LOCAL_BASE | string
    generation?: number
    mainProxyTarget?: string
  }
  | {
    kind: 'attached-http'
    serverUrl: string
    rendererBaseUrl: typeof CRADLE_SERVER_LOCAL_BASE | string
    mainProxyTarget?: string
  }

let connectionKind: DesktopServerConnectionKind | null = null
let rendererServerUrlOverride: string | null = null
let networkServerUrlOverride: string | null = null

export function resetServerTransportBaseUrlStateForTests(): void {
  connectionKind = null
  rendererServerUrlOverride = null
  networkServerUrlOverride = null
  resetRuntimeServerUrlForTests()
}

/**
 * Apply Desktop ready endpoint + optional connection discriminant.
 * Persisted/user-entered endpoints stay HTTP(S)-only via `setRuntimeServerUrl`.
 * Custom-scheme renderer base is tracked separately and never written to localStorage.
 */
export function applyDesktopServerReadyEndpoint(input: {
  serverUrl: string
  connection?: DesktopServerConnectionProjection | null
}): void {
  const connection = input.connection ?? null

  if (connection?.kind === 'owned-proxy' || connection?.kind === 'attached-http') {
    // Network/WS base is always status.serverUrl (HTTP(S) loopback or attached URL).
    const networkUrl = stripTrailingSlash(connection.serverUrl || input.serverUrl)
    const rendererUrl = resolveRendererBaseUrl(connection.rendererBaseUrl, networkUrl)
    connectionKind = connection.kind
    networkServerUrlOverride = networkUrl
    rendererServerUrlOverride = rendererUrl
    setRuntimeServerUrl(networkUrl)
    return
  }

  // Older Desktop / browser: single HTTP(S) endpoint for fetch and WebSocket.
  connectionKind = null
  networkServerUrlOverride = null
  rendererServerUrlOverride = null
  setRuntimeServerUrl(input.serverUrl)
}

/** Renderer-facing Server base (`cradle-server://local` when Main proxies). */
export function getRendererServerUrl(): string {
  return rendererServerUrlOverride ?? getConfiguredServerUrl()
}

/**
 * Loopback / network Server base for native WebSocket (PTY, /sync).
 * Always status.`serverUrl` — never `cradle-server:`.
 */
export function getServerNetworkUrl(): string {
  return networkServerUrlOverride ?? getConfiguredServerUrl()
}

export function getDesktopServerConnectionKind(): DesktopServerConnectionKind | null {
  return connectionKind
}

/**
 * True when fetch/SSE use the custom scheme and Main injects credentials.
 * Applies to owned-proxy and attached-http when rendererBaseUrl is cradle-server://local.
 */
export function isCustomSchemeProxyMode(): boolean {
  return isCradleServerLocalUrl(getRendererServerUrl())
}

export function isCradleServerLocalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'cradle-server:' && url.hostname === 'local' && !url.port
  }
  catch {
    return false
  }
}

/**
 * Identity for Cradle Server bases. Must not use `URL.origin` for custom schemes
 * (opaque / `"null"` origin breaks equality).
 */
export function isSameServerEndpoint(left: string, right: string): boolean {
  try {
    const a = new URL(left)
    const b = new URL(right)
    return (
      a.protocol === b.protocol
      && a.hostname === b.hostname
      && a.port === b.port
      && a.username === b.username
      && a.password === b.password
    )
  }
  catch {
    return false
  }
}

/** Rebase pathname/search/hash onto `base` without relying on origin equality. */
export function rebaseToServerBase(input: string | URL, base: string): URL {
  const baseUrl = new URL(base)
  const inputUrl = input instanceof URL ? input : new URL(input, baseUrl)
  return new URL(`${inputUrl.pathname}${inputUrl.search}${inputUrl.hash}`, baseUrl)
}

/**
 * True when `input` targets the configured Cradle Server.
 * Matches the renderer base and the network `serverUrl` so stale HTTP absolute
 * URLs from the generated client still classify as Server traffic in proxy mode.
 */
export function isCradleServerRequestUrl(input: string | URL, serverBase = getRendererServerUrl()): boolean {
  try {
    const resolved = input instanceof URL ? input : new URL(input, serverBase)
    if (isSameServerEndpoint(resolved.toString(), serverBase)) {
      return true
    }
    const networkBase = getServerNetworkUrl()
    return isSameServerEndpoint(resolved.toString(), networkBase)
  }
  catch {
    return false
  }
}

function resolveRendererBaseUrl(rendererBaseUrl: string, networkUrl: string): string {
  const trimmed = stripTrailingSlash(rendererBaseUrl || networkUrl)
  if (isCradleServerLocalUrl(trimmed)) {
    return CRADLE_SERVER_LOCAL_BASE
  }
  return trimmed
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '') || value
}
