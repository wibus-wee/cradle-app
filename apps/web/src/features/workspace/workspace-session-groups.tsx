import { memo, useCallback } from 'react'

import { openNewChat } from '~/navigation/navigation-commands'

import type { WorkspaceSession } from './use-session'
import type { WorkspaceSessionGroup } from './use-session-group'
import { WorkspaceSessionGroupSectionView } from './workspace-session-group-section-view'
import { useWorkspaceSidebarUiStore } from './workspace-sidebar-ui-store'

interface WorkspaceSessionGroupSectionProps {
  group: WorkspaceSessionGroup
  sessions: WorkspaceSession[]
  workspaceId: string
  children: React.ReactNode
  onRenameGroup: (group: WorkspaceSessionGroup) => void
  onDeleteGroup: (group: WorkspaceSessionGroup) => void
}

export const WorkspaceSessionGroupSection = memo(({
  group,
  sessions,
  workspaceId,
  children,
  onRenameGroup,
  onDeleteGroup,
}: WorkspaceSessionGroupSectionProps) => {
  const expanded = useWorkspaceSidebarUiStore(
    state => state.expandedSessionGroupIds[group.id] === true,
  )
  const setSessionGroupExpanded = useWorkspaceSidebarUiStore(
    state => state.setSessionGroupExpanded,
  )

  const toggleExpanded = useCallback(() => {
    setSessionGroupExpanded(group.id, !expanded)
  }, [expanded, group.id, setSessionGroupExpanded])

  const handleCreateSessionInGroup = useCallback(() => {
    openNewChat({ workspaceId, sessionGroupId: group.id })
  }, [group.id, workspaceId])

  return (
    <WorkspaceSessionGroupSectionView
      group={group}
      sessionCount={sessions.length}
      expanded={expanded}
      onToggleExpanded={toggleExpanded}
      onCreateSession={handleCreateSessionInGroup}
      onRenameGroup={onRenameGroup}
      onDeleteGroup={onDeleteGroup}
    >
      {children}
    </WorkspaceSessionGroupSectionView>
  )
})
