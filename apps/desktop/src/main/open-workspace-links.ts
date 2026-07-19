/* Parses cradle://open/workspace deep links for CLI "cradle open" navigation. */

const OPEN_PROTOCOL = 'cradle:'
const OPEN_HOST = 'open'
const OPEN_WORKSPACE_PATH = '/workspace'

export interface OpenWorkspaceRequest {
  workspaceId: string
  originalUrl: string
}

export class OpenWorkspaceLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenWorkspaceLinkError'
  }
}

export function parseOpenWorkspaceUrl(rawUrl: string): OpenWorkspaceRequest {
  let url: URL
  try {
    url = new URL(rawUrl)
  }
  catch {
    throw new OpenWorkspaceLinkError(`Invalid open workspace URL: ${rawUrl}`)
  }

  if (url.protocol !== OPEN_PROTOCOL) {
    throw new OpenWorkspaceLinkError('Open workspace link must use the cradle:// protocol')
  }
  if (url.hostname !== OPEN_HOST) {
    throw new OpenWorkspaceLinkError('Open workspace link must target cradle://open/workspace')
  }

  // URL parser treats cradle://open/workspace as host=open pathname=/workspace
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  if (pathname !== OPEN_WORKSPACE_PATH) {
    throw new OpenWorkspaceLinkError('Open workspace link must target cradle://open/workspace')
  }

  const workspaceId = url.searchParams.get('id')?.trim()
  if (!workspaceId) {
    throw new OpenWorkspaceLinkError('Open workspace link requires an id query parameter')
  }

  // Reject unexpected params to keep the surface tight (same spirit as plugin install links).
  for (const key of url.searchParams.keys()) {
    if (key !== 'id') {
      throw new OpenWorkspaceLinkError(`Unsupported open workspace link parameter: ${key}`)
    }
  }

  return {
    workspaceId,
    originalUrl: rawUrl,
  }
}

export function isOpenWorkspaceUrl(value: string): boolean {
  try {
    parseOpenWorkspaceUrl(value)
    return true
  }
  catch {
    return false
  }
}

export function collectOpenWorkspaceUrls(values: readonly string[]): string[] {
  return values.filter(value => isOpenWorkspaceUrl(value))
}

export function buildOpenWorkspaceTrayAction(workspaceId: string): {
  actionId: 'open-workspace'
  payload: { workspaceId: string }
} {
  return {
    actionId: 'open-workspace',
    payload: { workspaceId },
  }
}
