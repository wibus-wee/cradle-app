import {
  getConfiguredServerUrl,
  resetRuntimeServerUrlForTests,
  setRuntimeServerUrl,
} from '../server-endpoint-preferences'

export type DesktopServerConnectionKind = 'owned-ipc' | 'attached-http'

/**
 * Forward-compatible Desktop ready connection projection.
 * Absent on older Desktop builds — Web falls back to HTTP(S) `serverUrl`.
 *
 * WebSocket clients always use `serverUrl` via `getServerNetworkUrl()`;
 * there is no separate `wsBaseUrl` in v1.
 */
export type DesktopServerConnectionProjection
  = | {
    kind: 'owned-ipc'
    serverUrl: string
    rendererBaseUrl: string
    generation: number
  }
  | {
    kind: 'attached-http'
    serverUrl: string
    rendererBaseUrl: string
  }

let connectionKind: DesktopServerConnectionKind | null = null
let rendererServerUrlOverride: string | null = null
let networkServerUrlOverride: string | null = null
let desktopServerGeneration: number | null = null

export function resetServerTransportBaseUrlStateForTests(): void {
  connectionKind = null
  rendererServerUrlOverride = null
  networkServerUrlOverride = null
  desktopServerGeneration = null
  resetRuntimeServerUrlForTests()
}

/**
 * Apply Desktop ready endpoint + optional connection discriminant.
 * Persisted/user-entered endpoints stay HTTP(S)-only via `setRuntimeServerUrl`.
 * Renderer transport state is tracked separately from persisted endpoint preferences.
 */
export function applyDesktopServerReadyEndpoint(input: {
  serverUrl: string
  connection?: DesktopServerConnectionProjection | null
}): void {
  const connection = input.connection ?? null

  if (
    connection?.kind === 'owned-ipc'
    || connection?.kind === 'attached-http'
  ) {
    // Network/WS base is always status.serverUrl (HTTP(S) loopback or attached URL).
    const networkUrl = stripTrailingSlash(connection.serverUrl || input.serverUrl)
    const rendererUrl = stripTrailingSlash(connection.rendererBaseUrl || networkUrl)
    connectionKind = connection.kind
    desktopServerGeneration = connection.kind === 'owned-ipc' ? connection.generation : null
    networkServerUrlOverride = networkUrl
    rendererServerUrlOverride = rendererUrl
    setRuntimeServerUrl(networkUrl)
    return
  }

  // Older Desktop / browser: single HTTP(S) endpoint for fetch and WebSocket.
  connectionKind = null
  desktopServerGeneration = null
  networkServerUrlOverride = null
  rendererServerUrlOverride = null
  setRuntimeServerUrl(input.serverUrl)
}

/** Renderer-facing HTTP Server base used for URL construction. */
export function getRendererServerUrl(): string {
  return rendererServerUrlOverride ?? getConfiguredServerUrl()
}

/**
 * Loopback / network Server base for native WebSocket (PTY, /sync).
 * Always status.`serverUrl`.
 */
export function getServerNetworkUrl(): string {
  return networkServerUrlOverride ?? getConfiguredServerUrl()
}

export function getDesktopServerConnectionKind(): DesktopServerConnectionKind | null {
  return connectionKind
}

export function isDesktopIpcProxyMode(): boolean {
  return connectionKind === 'owned-ipc'
}

export function getDesktopServerGeneration(): number | null {
  return desktopServerGeneration
}

/** Identity for Cradle Server bases. */
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

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '') || value
}
