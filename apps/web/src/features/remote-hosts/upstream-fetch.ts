import { queryOptions } from '@tanstack/react-query'

import { client } from '~/api-gen/client.gen'

/**
 * Transparent Upstream Gateway client helper.
 *
 * Uses the generated api-gen `client` (so `baseUrl` / Electron server URL apply).
 * We intentionally do **not** call `allRemoteHostsByHostIdUpstream_2`: OpenAPI
 * exports `/upstream/*`, and hey-api leaves the bare `*` unreplaced.
 *
 * `path` is a remote Cradle Server path, e.g. `/workspaces` or
 * `/workspaces/:id/files/children?path=src`.
 */
export type RemoteUpstreamRequestInit = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  body?: unknown
  headers?: HeadersInit
  signal?: AbortSignal
}

function buildUpstreamRequestUrl(hostId: string, path: string): {
  url: string
  query?: Record<string, string>
} {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const parsed = new URL(normalizedPath, 'http://upstream.invalid')
  const query: Record<string, string> = {}
  parsed.searchParams.forEach((value, key) => {
    query[key] = value
  })
  return {
    // Concrete path (no `{*}` template) — hey-api cannot substitute bare `*`.
    url: `/remote-hosts/${encodeURIComponent(hostId)}/upstream${parsed.pathname}`,
    query: Object.keys(query).length > 0 ? query : undefined,
  }
}

export async function fetchRemoteUpstreamJson<T>(
  hostId: string,
  path: string,
  init?: RemoteUpstreamRequestInit,
): Promise<T> {
  const { url, query } = buildUpstreamRequestUrl(hostId, path)
  const method = init?.method ?? 'GET'
  const { data } = await client.request({
    method,
    url,
    query,
    body: init?.body,
    headers: init?.headers,
    signal: init?.signal,
    throwOnError: true,
  })
  return data as T
}

export function remoteHostUpstreamQueryKey(hostId: string, ...parts: string[]) {
  return ['remote-host-upstream', hostId, ...parts] as const
}

/** React Query options for a GET upstream JSON path. */
export function remoteHostUpstreamQueryOptions<T>(
  hostId: string,
  path: string,
  keyParts: string[] = [path],
) {
  return queryOptions({
    queryKey: remoteHostUpstreamQueryKey(hostId, ...keyParts),
    queryFn: ({ signal }) => fetchRemoteUpstreamJson<T>(hostId, path, { signal }),
  })
}
