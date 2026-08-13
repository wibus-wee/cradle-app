import {
  getRendererServerUrl,
  getServerNetworkUrl,
  isDesktopIpcProxyMode,
  isSameServerEndpoint,
  rebaseToServerBase,
} from './server-transport/base-url'
import { desktopIpcFetch, isDesktopIpcFetchAvailable } from './server-transport/desktop-ipc-fetch'

/**
 * Fetch hook for Cradle Server traffic.
 * Classifies requests against the active renderer and network Server bases. In owned Desktop
 * mode, Main owns the bounded localhost transport and Renderer credential headers are stripped.
 * Browser/attached HTTP continues to use native Fetch.
 */
export async function cradleFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const rendererBase = getRendererServerUrl()
  const networkBase = getServerNetworkUrl()
  const inputUrl = new URL(input instanceof Request ? input.url : input.toString(), rendererBase)
  const targetsServer
    = isSameServerEndpoint(inputUrl.toString(), rendererBase)
      || isSameServerEndpoint(inputUrl.toString(), networkBase)

  // Preserve Request/body when already on the renderer base; otherwise rebase path.
  const resolvedInput
    = !targetsServer || isAlreadyOnBase(inputUrl, rendererBase)
      ? input
      : input instanceof Request
        ? new Request(rebaseToServerBase(inputUrl, rendererBase), input)
        : rebaseToServerBase(inputUrl, rendererBase)

  // api-gen calls `fetch(request)` with no init. Start from the Request's
  // headers so Content-Type / auth already on the Request are not wiped by an
  // empty Headers override — then strip credential headers in proxy mode.
  const headers = new Headers(resolvedInput instanceof Request ? resolvedInput.headers : undefined)
  new Headers(init.headers).forEach((value, key) => {
    headers.set(key, value)
  })

  const contentType = headers.get('content-type')?.toLowerCase() ?? ''
  const ipcEligible = !contentType.startsWith('multipart/form-data')
  if (
    targetsServer
    && ipcEligible
    && isDesktopIpcProxyMode()
    && isDesktopIpcFetchAvailable()
  ) {
    headers.delete('authorization')
    headers.delete('cookie')
    headers.delete('proxy-authorization')
    headers.delete('x-cradle-relay-token')
    headers.delete('x-cradle-token')
    const request = resolvedInput instanceof Request
      ? new Request(resolvedInput, { ...init, credentials: 'omit', headers })
      : new Request(resolvedInput, { ...init, credentials: 'omit', headers })
    return await desktopIpcFetch(request)
  }

  return await fetch(resolvedInput, { ...init, credentials: 'include', headers })
}

function isAlreadyOnBase(inputUrl: URL, serverBase: string): boolean {
  try {
    const base = new URL(serverBase)
    return (
      inputUrl.protocol === base.protocol
      && inputUrl.hostname === base.hostname
      && inputUrl.port === base.port
    )
  }
  catch {
    return false
  }
}
