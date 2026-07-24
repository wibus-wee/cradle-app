import {
  DeleteLine as Trash2Icon,
  DownSmallLine as ChevronDownIcon,
  FolderLine as FolderClosedIcon,
  More2Line as MoreHorizontalIcon,
  PencilLine as PencilIcon,
  PlusLine as PlusIcon,
} from '@mingcute/react'
import type { TFunction } from 'i18next'
import { memo, useCallback, useMemo } from 'react'

import { Button } from '~/components/ui/button'
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '~/components/ui/menu'
import { openNewChat } from '~/navigation/navigation-commands'

import type { WorkspaceSession } from './use-session'
import type { WorkspaceSessionGroup } from './use-session-group'
import { useWorkspaceSidebarUiStore } from './workspace-sidebar-ui-store'

type WorkspaceTranslation = TFunction<'workspace'>

export function partitionWorkspaceSessions(
  sessions: readonly WorkspaceSession[],
  groups: readonly WorkspaceSessionGroup[],
): {
  grouped: Array<{ group: WorkspaceSessionGroup, sessions: WorkspaceSession[] }>
  ungrouped: WorkspaceSession[]
} {
  const sessionsByGroupId = new Map<string, WorkspaceSession[]>()
  const ungrouped: WorkspaceSession[] = []

  for (const session of sessions) {
    if (session.sessionGroupId) {
      const groupSessions = sessionsByGroupId.get(session.sessionGroupId)
      if (groupSessions) {
        groupSessions.push(session)
      }
      else {
        sessionsByGroupId.set(session.sessionGroupId, [session])
      }
    }
    else {
      ungrouped.push(session)
    }
  }

  const grouped = groups
    .map(group => ({
      group,
      sessions: sessionsByGroupId.get(group.id) ?? [],
    }))
    .filter(entry => entry.sessions.length > 0 || entry.group.status === 'active')

  return { grouped, ungrouped }
}

interface WorkspaceSessionGroupSectionProps {
  group: WorkspaceSessionGroup
  sessions: WorkspaceSession[]
  workspaceId: string
  t: WorkspaceTranslation
  children: React.ReactNode
  onRenameGroup: (group: WorkspaceSessionGroup) => void
  onDeleteGroup: (group: WorkspaceSessionGroup) => void
}

export const WorkspaceSessionGroupSection = memo(({
  group,
  sessions,
  workspaceId,
  t,
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
    <div
      className="ml-4.25 flex min-w-0 flex-col gap-0.5 border-l border-sidebar-border/50 pl-2 py-0.5"
      data-testid={`session-group-${group.id}`}
    >
      <div className="group flex min-w-0 items-center gap-0.5 pr-1">
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-expanded={expanded}
          data-testid={`session-group-toggle-${group.id}`}
        >
          {expanded
            ? <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            : <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground -rotate-90 transition-transform" aria-hidden="true" />}
          <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground/90">
            {group.title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {sessions.length}
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0 text-muted-foreground/70 hover:text-foreground"
          aria-label={t('sessionGroup.action.newSession')}
          title={t('sessionGroup.action.newSession')}
          data-testid={`session-group-new-session-${group.id}`}
          onClick={handleCreateSessionInGroup}
        >
          <PlusIcon className="size-3.5" aria-hidden="true" />
        </Button>
        <Menu>
          <MenuTrigger
            render={(
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-6 shrink-0 text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent/80 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 aria-expanded:opacity-100"
                aria-label={t('sessionGroup.action.menu')}
                data-testid={`session-group-menu-${group.id}`}
              />
            )}
          >
            <MoreHorizontalIcon className="size-3.5" aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="start" side="bottom">
            <MenuItem onClick={() => onRenameGroup(group)}>
              <PencilIcon aria-hidden="true" />
              {t('sessionGroup.action.rename')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => onDeleteGroup(group)}>
              <Trash2Icon aria-hidden="true" />
              {t('sessionGroup.action.delete')}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {expanded ? children : null}
    </div>
  )
})

interface SessionGroupMenuItemsProps {
  session: WorkspaceSession
  groups: WorkspaceSessionGroup[]
  t: WorkspaceTranslation
  onAddToGroup: (groupId: string) => void
  onRemoveFromGroup: () => void
  onCreateGroup: () => void
}

export function SessionGroupMenuItems({
  session,
  groups,
  t,
  onAddToGroup,
  onRemoveFromGroup,
  onCreateGroup,
}: SessionGroupMenuItemsProps) {
  const availableGroups = useMemo(
    () => groups.filter(group => group.id !== session.sessionGroupId),
    [groups, session.sessionGroupId],
  )

  if (session.sessionGroupId) {
    return (
      <>
        <MenuSeparator />
        <MenuItem onClick={onRemoveFromGroup}>
          {t('sessionGroup.action.removeFromGroup')}
        </MenuItem>
      </>
    )
  }

  if (availableGroups.length === 0) {
    return (
      <>
        <MenuSeparator />
        <MenuItem onClick={onCreateGroup}>
          {t('sessionGroup.action.createAndAdd')}
        </MenuItem>
      </>
    )
  }

  return (
    <>
      <MenuSeparator />
      {availableGroups.map(group => (
        <MenuItem key={group.id} onClick={() => onAddToGroup(group.id)}>
          {t('sessionGroup.action.addToGroup', { title: group.title })}
        </MenuItem>
      ))}
      <MenuItem onClick={onCreateGroup}>
        {t('sessionGroup.action.createAndAdd')}
      </MenuItem>
    </>
  )
}
