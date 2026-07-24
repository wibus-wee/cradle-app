import { fetchRemoteUpstreamJson } from '~/features/remote-hosts/upstream-fetch'
import type { CreateWorkspaceInput } from '~/features/workspace/use-workspace'

import type { Workspace } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readErrorCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null
  }
  if (typeof error.code === 'string') {
    return error.code
  }
  if (isRecord(error.error) && typeof error.error.code === 'string') {
    return error.error.code
  }
  return null
}

function toLocalCreateInput(
  hostId: string,
  remote: Workspace,
): CreateWorkspaceInput {
  return {
    name: remote.name,
    locator: {
      hostId,
      path: remote.locator.path,
      kind: remote.locator.kind,
      sourceWorkspaceId: remote.id,
    },
    gitIdentity: remote.gitIdentity,
  }
}

/**
 * Ensure the remote Cradle Server has a workspace for `path`, then return the
 * local create payload that mounts it (with `sourceWorkspaceId`).
 *
 * Flow:
 * 1. Resolve by path on the remote — reuse if already registered.
 * 2. Otherwise `POST /workspaces/from-directory` on the remote.
 * 3. If create races with an existing locator (409), resolve again.
 */
export async function ensureRemoteWorkspaceForPath(
  hostId: string,
  path: string,
): Promise<CreateWorkspaceInput> {
  const trimmed = path.trim()
  if (!trimmed) {
    throw new Error('Remote directory path is required.')
  }

  const existing = await fetchRemoteUpstreamJson<Workspace | null>(
    hostId,
    `/workspaces/resolve?hostId=${encodeURIComponent('local')}&path=${encodeURIComponent(trimmed)}`,
  )
  if (existing?.id) {
    return toLocalCreateInput(hostId, existing)
  }

  try {
    const created = await fetchRemoteUpstreamJson<Workspace>(
      hostId,
      '/workspaces/from-directory',
      {
        method: 'POST',
        body: { path: trimmed },
      },
    )
    return toLocalCreateInput(hostId, created)
  }
  catch (error) {
    if (readErrorCode(error) !== 'workspace_locator_exists') {
      throw error
    }
    const raced = await fetchRemoteUpstreamJson<Workspace | null>(
      hostId,
      `/workspaces/resolve?hostId=${encodeURIComponent('local')}&path=${encodeURIComponent(trimmed)}`,
    )
    if (!raced?.id) {
      throw error
    }
    return toLocalCreateInput(hostId, raced)
  }
}
