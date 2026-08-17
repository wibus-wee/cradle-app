import { queryOptions } from '@tanstack/react-query'

import { client } from '~/api-gen/client.gen'

/**
 * Transparent Upstream Gateway client helper.
 *
 * Uses the generated api-gen `client` (so `baseUrl` / Electron server URL apply).
 * We intentionally do **not** call the generated `/nodes/:id/upstream/*` helper:
 * OpenAPI exports the path with a bare `*`, and hey-api leaves it unreplaced.
 *
 * `path` is a path on the target Node's upstream Cradle Server, e.g. `/workspaces`
 * or `/workspaces/:id/files/children?path=src`.
 */
export type NodeUpstreamRequestInit = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  body?: unknown
  headers?: HeadersInit
  signal?: AbortSignal
}

function buildUpstreamRequestUrl(nodeId: string, path: string): {
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
    url: `/nodes/${encodeURIComponent(nodeId)}/upstream${parsed.pathname}`,
    query: Object.keys(query).length > 0 ? query : undefined,
  }
}

export async function fetchNodeUpstreamJson<T>(
  nodeId: string,
  path: string,
  init?: NodeUpstreamRequestInit,
): Promise<T> {
  const { url, query } = buildUpstreamRequestUrl(nodeId, path)
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

export function nodeUpstreamQueryKey(nodeId: string, ...parts: string[]) {
  return ['node-upstream', nodeId, ...parts] as const
}

/** React Query options for a GET upstream JSON path. */
export function nodeUpstreamQueryOptions<T>(
  nodeId: string,
  path: string,
  keyParts: string[] = [path],
) {
  return queryOptions({
    queryKey: nodeUpstreamQueryKey(nodeId, ...keyParts),
    queryFn: ({ signal }) => fetchNodeUpstreamJson<T>(nodeId, path, { signal }),
  })
}
