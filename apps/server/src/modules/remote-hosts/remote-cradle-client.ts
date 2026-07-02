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

export interface RemoteCradleClient {
  readHealth(): Promise<RemoteCradleServerHealthPayload>
  listWorkspaces(): Promise<RemoteWorkspaceView[]>
  listWorkspaceFiles(remoteWorkspaceId: string): Promise<RemoteWorkspaceFileEntry[]>
  listWorkspaceFileChildren(remoteWorkspaceId: string, relativePath: string): Promise<RemoteWorkspaceFileEntry[]>
  readWorkspaceFileContent(remoteWorkspaceId: string, relativePath: string): Promise<RemoteWorkspaceFileContent>
  readWorkspaceFileInfo(remoteWorkspaceId: string, relativePath: string): Promise<RemoteWorkspaceFileInfo | null>
}

export function createRemoteCradleClient(baseUrl: string): RemoteCradleClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

  return {
    readHealth: () => requestJson<RemoteCradleServerHealthPayload>(normalizedBaseUrl, '/health'),
    listWorkspaces: () => requestJson<RemoteWorkspaceView[]>(normalizedBaseUrl, '/workspaces'),
    listWorkspaceFiles: remoteWorkspaceId => requestJson<RemoteWorkspaceFileEntry[]>(
      normalizedBaseUrl,
      `/workspaces/${encodeURIComponent(remoteWorkspaceId)}/files`,
    ),
    listWorkspaceFileChildren: (remoteWorkspaceId, relativePath) => requestJson<RemoteWorkspaceFileEntry[]>(
      normalizedBaseUrl,
      `/workspaces/${encodeURIComponent(remoteWorkspaceId)}/files/children`,
      { path: relativePath },
    ),
    readWorkspaceFileContent: (remoteWorkspaceId, relativePath) => requestJson<RemoteWorkspaceFileContent>(
      normalizedBaseUrl,
      `/workspaces/${encodeURIComponent(remoteWorkspaceId)}/files/content`,
      { path: relativePath },
    ),
    readWorkspaceFileInfo: (remoteWorkspaceId, relativePath) => requestJson<RemoteWorkspaceFileInfo | null>(
      normalizedBaseUrl,
      `/workspaces/${encodeURIComponent(remoteWorkspaceId)}/files/info`,
      { path: relativePath },
    ),
  }
}

async function requestJson<T>(baseUrl: string, path: string, query?: Record<string, string | null | undefined>): Promise<T> {
  const url = new URL(path, `${baseUrl}/`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value)
    }
  }

  let response: Response
  try {
    response = await fetch(url)
  }
  catch (error) {
    throw new AppError({
      code: 'remote_cradle_request_failed',
      status: 503,
      message: `Remote Cradle Server request failed: ${error instanceof Error ? error.message : String(error)}`,
      details: { url: url.toString() },
    })
  }

  if (!response.ok) {
    throw new AppError({
      code: 'remote_cradle_http_error',
      status: response.status === 404 ? 404 : 502,
      message: `Remote Cradle Server returned HTTP ${response.status} for ${url.pathname}.`,
      details: { url: url.toString(), status: response.status },
    })
  }

  return await response.json() as T
}
