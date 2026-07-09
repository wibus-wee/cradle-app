import {
  buildProxiedJsonRequest,
  tryProxyLinkedSessionRequest,
} from '../../session/remote-projection'

export async function proxyLinkedChatSessionIfNeeded(input: {
  localSessionId: string
  upstreamPathWithQuery: string
  request: Request
  jsonBody?: unknown
}): Promise<Response | null> {
  const proxiedRequest = input.jsonBody === undefined
    ? input.request
    : buildProxiedJsonRequest(input.request, input.jsonBody)
  return await tryProxyLinkedSessionRequest(
    input.localSessionId,
    input.upstreamPathWithQuery,
    proxiedRequest,
  )
}

export function chatSessionUpstreamPath(localSessionId: string, suffix: string, search = ''): string {
  return `/chat/sessions/${encodeURIComponent(localSessionId)}${suffix}${search}`
}
