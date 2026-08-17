import type { GetWorkspacesResponse } from '~/api-gen/types.gen'

export type Workspace = GetWorkspacesResponse[number]

export const LOCAL_WORKSPACE_NODE_ID = 'local'

export function getWorkspaceLocatorPath(workspace: Pick<Workspace, 'locator'>): string {
  return workspace.locator.path
}

export function isLocalWorkspace(workspace: Pick<Workspace, 'locator'>): boolean {
  return workspace.locator.nodeId === LOCAL_WORKSPACE_NODE_ID
}

export function isMultiFolderWorkspace(
  workspace: Pick<Workspace, 'multiFolder'>,
): boolean {
  return workspace.multiFolder
}

export function isWorkEligibleWorkspace(
  workspace: Pick<Workspace, 'locator' | 'availability' | 'multiFolder'>,
): boolean {
  return isLocalWorkspace(workspace)
    && workspace.availability === 'available'
    && !workspace.multiFolder
}

export function getLocalWorkspacePath(workspace: Pick<Workspace, 'locator' | 'availability'> | null | undefined): string | null {
  return workspace && isLocalWorkspace(workspace) && workspace.availability === 'available'
    ? workspace.locator.path
    : null
}

export function getWorkspaceLocationLabel(workspace: Pick<Workspace, 'locator'>): string {
  return isLocalWorkspace(workspace)
    ? workspace.locator.path
    : `${workspace.locator.nodeId}:${workspace.locator.path}`
}
