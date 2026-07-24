import {
  AlertLine as CircleAlertIcon,
  FolderLine as FolderClosedIcon,
  FolderOpenLine as FolderOpenIcon,
  More2Line as MoreHorizontalIcon,
  PinLine as PinIcon,
} from '@mingcute/react'
import { FolderSymlink as FolderSymlinkIcon } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '~/components/ui/context-menu'
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '~/components/ui/menu'
import type { Workspace } from '~/features/workspace/types'
import { isLocalWorkspace } from '~/features/workspace/types'

export interface WorkspaceMenuAction {
  key: string
  label: string
  icon: ReactNode
  testId: string
  invoke: () => void | Promise<void>
  variant?: 'default' | 'destructive'
  separatorBefore?: boolean
}

export interface WorkspaceGroupDisclosureViewProps {
  workspace: Workspace
  workspacePinned: boolean
  workspaceActions: WorkspaceMenuAction[]
  expanded: boolean
  overlays: ReactNode
  children: ReactNode
  onToggleExpanded: () => void
  onOpenWorkspace: () => void
}

function renderWorkspaceMenuActions(
  actions: WorkspaceMenuAction[],
  surface: 'button' | 'context',
) {
  return actions.map((action) => {
    const content = (
      <>
        {action.icon}
        {action.label}
      </>
    )

    if (surface === 'context') {
      return (
        <Fragment key={action.key}>
          {action.separatorBefore ? <ContextMenuSeparator /> : null}
          <ContextMenuItem
            variant={action.variant}
            onSelect={() => {
              void action.invoke()
            }}
            data-testid={`${action.testId}-context`}
          >
            {content}
          </ContextMenuItem>
        </Fragment>
      )
    }

    return (
      <Fragment key={action.key}>
        {action.separatorBefore ? <MenuSeparator /> : null}
        <MenuItem
          variant={action.variant}
          onClick={() => {
            void action.invoke()
          }}
          data-testid={action.testId}
        >
          {content}
        </MenuItem>
      </Fragment>
    )
  })
}

export function WorkspaceGroupDisclosureView({
  workspace,
  workspacePinned,
  workspaceActions,
  expanded,
  overlays,
  children,
  onToggleExpanded,
  onOpenWorkspace,
}: WorkspaceGroupDisclosureViewProps) {
  const { t } = useTranslation('workspace')

  const toggleExpanded = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onToggleExpanded()
  }

  const headerContent = (
    <div className="group flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-accent/50">
      <button
        type="button"
        onClick={toggleExpanded}
        onPointerDown={event => event.stopPropagation()}
        aria-label={t('workspace.aria.toggleExpanded')}
        aria-expanded={expanded}
        className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-fill/70 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        data-testid={`workspace-toggle-${workspace.id}`}
      >
        {isLocalWorkspace(workspace)
          ? expanded
            ? <FolderOpenIcon className="size-3.5" aria-hidden="true" />
            : <FolderClosedIcon className="size-3.5" aria-hidden="true" />
          : <FolderSymlinkIcon className="size-3.5" aria-hidden="true" />}
      </button>

      <button
        type="button"
        onClick={onOpenWorkspace}
        data-testid={`workspace-open-${workspace.id}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {workspacePinned
          ? (
              <PinIcon
                className="size-3 shrink-0 !text-primary/60"
                aria-label={t('workspace.aria.pinned')}
                data-testid={`workspace-pin-indicator-${workspace.id}`}
              />
            )
          : null}
        <span className="truncate text-xs font-medium text-sidebar-foreground/80">
          {workspace.name}
        </span>
        {workspace.availability === 'missing'
          ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-medium text-destructive">
                <CircleAlertIcon className="size-2.5" aria-hidden="true" />
                {t('workspace.state.missing')}
              </span>
            )
          : null}
      </button>

      <Menu>
        <MenuTrigger
          render={(
            <Button
              variant="ghost"
              size="icon-xs"
              className="-mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={event => event.stopPropagation()}
              aria-label={t('workspace.aria.menu')}
              data-testid={`workspace-menu-trigger-${workspace.id}`}
            />
          )}
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup align="start" side="bottom" sideOffset={4}>
          {renderWorkspaceMenuActions(workspaceActions, 'button')}
        </MenuPopup>
      </Menu>
    </div>
  )

  return (
    <div
      className="flex min-w-0 flex-col"
      data-testid={`workspace-group-${workspace.id}`}
      data-workspace-pinned={workspacePinned ? 'true' : 'false'}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>{headerContent}</ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          {renderWorkspaceMenuActions(workspaceActions, 'context')}
        </ContextMenuContent>
      </ContextMenu>
      {overlays}
      {expanded ? children : null}
    </div>
  )
}
