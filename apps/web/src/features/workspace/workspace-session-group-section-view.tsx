import {
  DeleteLine as TrashIcon,
  DownSmallLine as ChevronDownIcon,
  FolderLine as FolderIcon,
  More2Line as MoreHorizontalIcon,
  PencilLine as PencilIcon,
  PlusLine as PlusIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '~/components/ui/menu'

import type { WorkspaceSessionGroup } from './use-session-group'

export interface WorkspaceSessionGroupSectionViewProps {
  group: WorkspaceSessionGroup
  sessionCount: number
  expanded: boolean
  children: ReactNode
  onToggleExpanded: () => void
  onCreateSession: () => void
  onRenameGroup: (group: WorkspaceSessionGroup) => void
  onDeleteGroup: (group: WorkspaceSessionGroup) => void
}

export function WorkspaceSessionGroupSectionView({
  group,
  sessionCount,
  expanded,
  children,
  onToggleExpanded,
  onCreateSession,
  onRenameGroup,
  onDeleteGroup,
}: WorkspaceSessionGroupSectionViewProps) {
  const { t } = useTranslation('workspace')

  return (
    <div
      className="ml-4.25 flex min-w-0 flex-col gap-0.5 border-l border-sidebar-border/50 py-0.5 pl-2"
      data-testid={`session-group-${group.id}`}
    >
      <div className="group flex min-w-0 items-center gap-0.5 pr-1">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-expanded={expanded}
          data-testid={`session-group-toggle-${group.id}`}
        >
          <ChevronDownIcon
            className={
              expanded
                ? 'size-3.5 shrink-0 text-muted-foreground'
                : 'size-3.5 -rotate-90 shrink-0 text-muted-foreground transition-transform'
            }
            aria-hidden="true"
          />
          <FolderIcon
            className="size-3.5 shrink-0 text-muted-foreground/80"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground/90">
            {group.title}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {sessionCount}
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
          onClick={onCreateSession}
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
            <MenuItem
              variant="destructive"
              onClick={() => onDeleteGroup(group)}
            >
              <TrashIcon aria-hidden="true" />
              {t('sessionGroup.action.delete')}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {expanded ? children : null}
    </div>
  )
}
