import {
  getRendererServerUrl,
  getServerNetworkUrl,
  isCustomSchemeProxyMode,
  isSameServerEndpoint,
  rebaseToServerBase,
} from './server-transport/base-url'

/**
 * Fetch hook for Cradle Server traffic.
 * Rebases absolute/relative Server URLs onto the renderer base (`cradle-server://local`
 * in proxy mode). Treats both the renderer base and the network/loopback `serverUrl` as
 * Cradle Server destinations so stale HTTP absolute URLs still migrate to the custom scheme.
 * In custom-scheme proxy mode, strips renderer Authorization/Cookie — Electron Main injects
 * credentials. Attached/browser HTTP may still attach Bearer.
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

  const customScheme = targetsServer && isCustomSchemeProxyMode()

  // api-gen calls `fetch(request)` with no init. Start from the Request's
  // headers so Content-Type / auth already on the Request are not wiped by an
  // empty Headers override — then strip credential headers in proxy mode.
  const headers = new Headers(resolvedInput instanceof Request ? resolvedInput.headers : undefined)
  new Headers(init.headers).forEach((value, key) => {
    headers.set(key, value)
  })

  if (customScheme) {
    headers.delete('authorization')
    headers.delete('cookie')
    headers.delete('proxy-authorization')
    // Rebuild Request so credential headers are not left on the Request object
    // itself (fetch(init.headers) alone can leave them visible to inspectors/tests).
    if (resolvedInput instanceof Request) {
      return await fetch(new Request(resolvedInput, {
        ...init,
        credentials: 'omit',
        headers,
      }))
    }
    return await fetch(resolvedInput, {
      ...init,
      credentials: 'omit',
      headers,
    })
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
