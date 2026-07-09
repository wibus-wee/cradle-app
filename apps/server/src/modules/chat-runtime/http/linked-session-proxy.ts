import { Elysia } from 'elysia'

import {
  buildProxiedJsonRequest,
  tryProxyLinkedSessionRequest,
} from '../../session/remote-projection'

/**
 * Paths under `/chat/sessions/:sessionId/...` for a projected remote session
 * are forwarded through the remote-host upstream gateway. Non-session chat
 * routes (composer drafts, global catalogs) stay local.
 */
export function matchChatSessionPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/sessions\/([^/]+)(?:\/|$)/)
  if (!match) {
    return null
  }
  try {
    return decodeURIComponent(match[1] ?? '')
  }
  catch {
    return match[1] ?? null
  }
}

export async function maybeProxyLinkedChatRequest(
  request: Request,
  parsedBody?: unknown,
): Promise<Response | null> {
  const url = new URL(request.url)
  const localSessionId = matchChatSessionPath(url.pathname)
  if (!localSessionId) {
    return null
  }

  const method = request.method.toUpperCase()
  const hasParsedBody = parsedBody !== undefined && method !== 'GET' && method !== 'HEAD'
  const proxiedRequest = hasParsedBody
    ? buildProxiedJsonRequest(request, parsedBody)
    : request

  // Upstream path is the remote Cradle Server path (without /remote-hosts/.../upstream).
  // rewritePathForRemoteSession swaps local session id → remoteSessionId.
  const pathWithQuery = `${url.pathname}${url.search}`
  return await tryProxyLinkedSessionRequest(localSessionId, pathWithQuery, proxiedRequest)
}

/**
 * Early intercept so every `/chat/sessions/:sessionId/*` route (response, queue,
 * cancel, settings, provider-threads, events, …) transparently proxies when the
 * session is a remote projection.
 *
 * Uses `onBeforeHandle` with `as: 'global'` (same pattern as HTTP auth) because
 * `onRequest` has no options overload in this Elysia version, and the plugin is
 * mounted without its own routes.
 */
export const linkedChatSessionProxyPlugin = new Elysia({ name: 'linked-chat-session-proxy' })
  .onBeforeHandle({ as: 'global' }, async ({ request, body }) => {
    const proxied = await maybeProxyLinkedChatRequest(request, body)
    if (proxied) {
      return proxied
    }
  })
