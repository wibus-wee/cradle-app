import type { ReactNode } from 'react'
import { useCallback } from 'react'

import type { Workspace } from '~/features/workspace/types'
import { openWorkspaceDetail } from '~/navigation/navigation-commands'

import type { WorkspaceMenuAction } from './workspace-group-disclosure-view'
import { WorkspaceGroupDisclosureView } from './workspace-group-disclosure-view'
import { useWorkspaceSidebarUiStore } from './workspace-sidebar-ui-store'

export interface WorkspaceGroupDisclosureProps {
  workspace: Workspace
  workspacePinned: boolean
  workspaceActions: WorkspaceMenuAction[]
  overlays: ReactNode
  children: ReactNode
}

export function WorkspaceGroupDisclosure({
  workspace,
  workspacePinned,
  workspaceActions,
  overlays,
  children,
}: WorkspaceGroupDisclosureProps) {
  const expanded = useWorkspaceSidebarUiStore(
    state => state.collapsedWorkspaceIds[workspace.id] !== true,
  )
  const setWorkspaceExpanded = useWorkspaceSidebarUiStore(
    state => state.setWorkspaceExpanded,
  )
  const toggleExpanded = useCallback(() => {
    setWorkspaceExpanded(workspace.id, !expanded)
  }, [expanded, setWorkspaceExpanded, workspace.id])
  const openWorkspace = useCallback(() => {
    openWorkspaceDetail(workspace.id)
  }, [workspace.id])

  return (
    <WorkspaceGroupDisclosureView
      workspace={workspace}
      workspacePinned={workspacePinned}
      workspaceActions={workspaceActions}
      expanded={expanded}
      overlays={overlays}
      onToggleExpanded={toggleExpanded}
      onOpenWorkspace={openWorkspace}
    >
      {children}
    </WorkspaceGroupDisclosureView>
  )
}
