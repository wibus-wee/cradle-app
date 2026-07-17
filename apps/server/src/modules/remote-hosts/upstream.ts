import { z } from 'zod'

import { AppError } from '../../errors/app-error'

export interface RemoteWorkspaceLocator {
  hostId: string
  path: string
  kind?: 'project' | 'managed-worktree'
  sourceWorkspaceId?: string | null
}

export interface RemoteWorkspaceGitIdentity {
  originUrl?: string | null
  repoRoot?: string | null
  headSha?: string | null
  branch?: string | null
}

export interface RemoteWorkspaceView {
  id: string
  name: string
  locator: RemoteWorkspaceLocator
  gitIdentity: RemoteWorkspaceGitIdentity
  identifier: string
  pinned: number
  createdAt: number
  updatedAt: number
}

export interface RemoteWorkspaceFileEntry {
  type: 'file' | 'directory'
  name: string
  path: string
}

export interface RemoteWorkspaceFileContent {
  content: string | null
}

export interface RemoteWorkspaceFileInfo {
  name: string
  path: string
  size: number
  modifiedAt: number
  mimeType: string
  extension: string
  previewKind: 'text' | 'markdown' | 'image' | 'pdf' | 'office' | 'unsupported'
}

export interface RemoteCradleServerHealthPayload {
  status: 'ok'
  uptime: number
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
  }
  cpu: {
    percent: number | null
    userMicros: number
    systemMicros: number
    sampleMs: number | null
    usedMicros: number | null
    windowReady: boolean
  }
  timestamp: number
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
])

const CONTROLLER_OWNED_RESPONSE_HEADERS = new Set([
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-allow-origin',
  'access-control-allow-private-network',
  'access-control-expose-headers',
  'access-control-max-age',
])

const UPSTREAM_REQUEST_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'content-encoding',
  'content-language',
  'content-length',
  'content-type',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'if-unmodified-since',
  'pragma',
  'range',
  'user-agent',
])

const UpstreamErrorPayloadSchema = z.object({
  code: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().min(1).max(2_000).optional(),
})

async function readUpstreamErrorPayload(response: Response): Promise<{
  code?: string
  message?: string
}> {
  const text = await response.text().catch(() => '')
  if (!text) {
    return {}
  }
  try {
    const parsed = UpstreamErrorPayloadSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : {}
  }
  catch {
    return {}
  }
}

export function buildUpstreamUrl(baseUrl: string, pathWithQuery: string): URL {
  return new URL(pathWithQuery.replace(/^\//, ''), `${baseUrl.replace(/\/+$/, '')}/`)
}

export async function upstreamFetchByBaseUrl(
  baseUrl: string,
  pathWithQuery: string,
  init?: RequestInit,
): Promise<Response> {
  const url = buildUpstreamUrl(baseUrl, pathWithQuery)

  try {
    return await fetch(url, init)
  }
  catch (error) {
    throw new AppError({
      code: 'remote_cradle_request_failed',
      status: 503,
      message: `Remote Cradle Server request failed: ${error instanceof Error ? error.message : String(error)}`,
      details: { url: url.toString() },
    })
  }
}

export async function upstreamJsonByBaseUrl<T>(
  baseUrl: string,
  pathWithQuery: string,
  init?: RequestInit,
): Promise<T> {
  const response = await upstreamFetchByBaseUrl(baseUrl, pathWithQuery, init)
  if (!response.ok) {
    const upstreamError = await readUpstreamErrorPayload(response)
    throw new AppError({
      code: 'remote_cradle_http_error',
      status: response.status === 404 ? 404 : 502,
      message: [
        `Remote Cradle Server returned HTTP ${response.status} for ${pathWithQuery}.`,
        upstreamError.message,
      ].filter(Boolean).join(' '),
      details: {
        path: pathWithQuery,
        status: response.status,
        ...(upstreamError.code ? { upstreamCode: upstreamError.code } : {}),
        ...(upstreamError.message ? { upstreamMessage: upstreamError.message } : {}),
      },
    })
  }
  return await response.json() as T
}

export function buildUpstreamRequestHeaders(headers: Headers, upstreamHost: string): Headers {
  const filtered = new Headers()
  headers.forEach((value, key) => {
    if (UPSTREAM_REQUEST_HEADERS.has(key.toLowerCase())) {
      filtered.set(key, value)
    }
  })
  filtered.set('host', upstreamHost)
  return filtered
}

export function buildUpstreamResponseHeaders(headers: Headers): Headers {
  const filtered = new Headers()
  headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase()
    if (
      !HOP_BY_HOP_HEADERS.has(normalizedKey)
      && !CONTROLLER_OWNED_RESPONSE_HEADERS.has(normalizedKey)
    ) {
      filtered.set(key, value)
    }
  })
  return filtered
}

export async function proxyUpstreamRequestByBaseUrl(
  baseUrl: string,
  request: Request,
  upstreamPathWithQuery: string,
): Promise<Response> {
  const upstreamUrl = buildUpstreamUrl(baseUrl, upstreamPathWithQuery)
  const upstreamHost = upstreamUrl.host

  const method = request.method.toUpperCase()
  const headers = buildUpstreamRequestHeaders(request.headers, upstreamHost)
  const hasBody = method !== 'GET' && method !== 'HEAD'

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers,
      body: hasBody ? request.body : undefined,
      // @ts-expect-error Bun supports duplex for streaming request bodies.
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      signal: request.signal,
    })
  }
  catch (error) {
    throw new AppError({
      code: 'remote_cradle_request_failed',
      status: 503,
      message: `Remote Cradle Server request failed: ${error instanceof Error ? error.message : String(error)}`,
      details: { url: upstreamUrl.toString() },
    })
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: buildUpstreamResponseHeaders(upstreamResponse.headers),
  })
}
