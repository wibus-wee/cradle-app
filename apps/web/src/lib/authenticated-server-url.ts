import { postAuthResourceTicket, postAuthWebsocketTicket } from '~/api-gen/sdk.gen'

import { getServerUrl, getServerWebSocketUrl } from './electron'

export async function getAuthenticatedServerWebSocketUrl(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): Promise<string> {
  const { data } = await postAuthWebsocketTicket({
    body: { audience: path },
    throwOnError: true,
  })
  return getServerWebSocketUrl(path, { ...query, ticket: data.ticket })
}

export async function getAuthenticatedServerResourceUrl(path: string): Promise<string> {
  const url = new URL(path, getServerUrl())
  const { data } = await postAuthResourceTicket({
    body: { path: url.pathname },
    throwOnError: true,
  })
  url.searchParams.set('resourceTicket', data.ticket)
  return url.toString()
}
