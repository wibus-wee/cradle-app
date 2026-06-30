import type { GetWorkspacesResponse } from '~/api-gen/types.gen'

export type Workspace = GetWorkspacesResponse[number]

export const LOCAL_WORKSPACE_HOST_ID = 'local'

export function getWorkspaceLocatorPath(workspace: Pick<Workspace, 'locator'>): string {
  return workspace.locator.path
}

export function isLocalWorkspace(workspace: Pick<Workspace, 'locator'>): boolean {
  return workspace.locator.hostId === LOCAL_WORKSPACE_HOST_ID
}

export function getLocalWorkspacePath(workspace: Pick<Workspace, 'locator'> | null | undefined): string | null {
  return workspace && isLocalWorkspace(workspace) ? workspace.locator.path : null
}

export function getWorkspaceLocationLabel(workspace: Pick<Workspace, 'locator'>): string {
  return isLocalWorkspace(workspace)
    ? workspace.locator.path
    : `${workspace.locator.hostId}:${workspace.locator.path}`
}
