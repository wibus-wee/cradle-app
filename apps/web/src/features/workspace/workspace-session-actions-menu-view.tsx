import {
  ArchiveLine as ArchiveIcon,
  CopyLine as ClipboardCopyIcon,
  CopyLine as CopyIcon,
  DownloadLine as DownloadIcon,
  ExternalLinkLine as ExternalLinkIcon,
  MailLine as MailIcon,
  MailOpenLine as MailOpenIcon,
  PencilLine as PencilIcon,
  PinLine as PinIcon,
  PinLine as PinOffIcon,
  PlusLine as PlusIcon,
  Refresh1Line as RefreshCwIcon,
} from '@mingcute/react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
} from '~/components/ui/menu'

import type { WorkspaceSession } from './use-session'
import type { WorkspaceSessionGroup } from './use-session-group'
import type { WorkspaceSessionMenuAnchor } from './workspace-session-item-view'

type WorkspaceSessionMenuAction = {
  key: string
  label: string
  icon: React.ReactNode
  testId: string
  invoke: () => void | Promise<void>
  variant?: 'default' | 'destructive'
}

type WorkspaceSessionMenuActionGroup = {
  key: string
  actions: WorkspaceSessionMenuAction[]
}

export interface WorkspaceSessionActionsMenuViewProps {
  open: boolean
  anchor: WorkspaceSessionMenuAnchor | null
  session: WorkspaceSession | null
  sessionGroups: readonly WorkspaceSessionGroup[]
  canOpenInNewWindow: boolean
  canCopySessionId: boolean
  onOpenChange: (open: boolean) => void
  onOpenInSurface: () => void
  onOpenInNewWindow: () => void
  onRename: () => void
  onRegenerateTitle: () => void | Promise<void>
  onToggleReadState: () => void | Promise<void>
  onTogglePin: () => void | Promise<void>
  onCopyMarkdown: () => void | Promise<void>
  onExportZip: () => void | Promise<void>
  onCopySessionId: () => void | Promise<void>
  onArchive: () => void | Promise<void>
  onAddToGroup: (groupId: string) => void
  onRemoveFromGroup: () => void
  onCreateGroup: () => void
}

export function WorkspaceSessionActionsMenuView({
  open,
  anchor,
  session,
  sessionGroups,
  canOpenInNewWindow,
  canCopySessionId,
  onOpenChange,
  onOpenInSurface,
  onOpenInNewWindow,
  onRename,
  onRegenerateTitle,
  onToggleReadState,
  onTogglePin,
  onCopyMarkdown,
  onExportZip,
  onCopySessionId,
  onArchive,
  onAddToGroup,
  onRemoveFromGroup,
  onCreateGroup,
}: WorkspaceSessionActionsMenuViewProps) {
  const { t } = useTranslation('workspace')
  const menuOpen = open && anchor !== null && session !== null

  if (!session) {
    return <Menu open={false} onOpenChange={onOpenChange} />
  }

  const openActions: WorkspaceSessionMenuAction[] = [
    {
      key: 'open-surface',
      label: t('session.action.openInSurface'),
      icon: <PlusIcon />,
      testId: `session-menu-open-surface-${session.id}`,
      invoke: onOpenInSurface,
    },
  ]
  if (canOpenInNewWindow) {
    openActions.push({
      key: 'open-new-window',
      label: t('session.action.openInNewWindow'),
      icon: <ExternalLinkIcon />,
      testId: `session-menu-open-new-window-${session.id}`,
      invoke: onOpenInNewWindow,
    })
  }

  const copyActions: WorkspaceSessionMenuAction[] = [
    {
      key: 'copy-markdown',
      label: t('session.action.copyMarkdown'),
      icon: <ClipboardCopyIcon />,
      testId: `session-menu-copy-markdown-${session.id}`,
      invoke: onCopyMarkdown,
    },
    {
      key: 'export-zip',
      label: t('session.action.exportZip'),
      icon: <DownloadIcon />,
      testId: `session-menu-export-zip-${session.id}`,
      invoke: onExportZip,
    },
  ]
  if (canCopySessionId) {
    copyActions.push({
      key: 'copy-session-id',
      label: t('session.action.copySessionId'),
      icon: <CopyIcon />,
      testId: `session-menu-copy-session-id-${session.id}`,
      invoke: onCopySessionId,
    })
  }

  const actionGroups: WorkspaceSessionMenuActionGroup[] = [
    { key: 'open', actions: openActions },
    {
      key: 'edit',
      actions: [
        {
          key: 'rename',
          label: t('session.action.rename'),
          icon: <PencilIcon />,
          testId: `session-menu-rename-${session.id}`,
          invoke: onRename,
        },
        {
          key: 'regenerate-title',
          label: t('session.action.regenerateTitle'),
          icon: <RefreshCwIcon />,
          testId: `session-menu-regenerate-title-${session.id}`,
          invoke: onRegenerateTitle,
        },
      ],
    },
    {
      key: 'state',
      actions: [
        {
          key: 'toggle-read-state',
          label: session.unread
            ? t('session.action.markRead')
            : t('session.action.markUnread'),
          icon: session.unread ? <MailOpenIcon /> : <MailIcon />,
          testId: `session-menu-toggle-read-state-${session.id}`,
          invoke: onToggleReadState,
        },
        {
          key: 'toggle-pin',
          label: session.pinned
            ? t('session.action.unpin')
            : t('session.action.pin'),
          icon: session.pinned ? <PinOffIcon /> : <PinIcon />,
          testId: `session-menu-toggle-pin-${session.id}`,
          invoke: onTogglePin,
        },
      ],
    },
    { key: 'copy', actions: copyActions },
    {
      key: 'danger',
      actions: [
        {
          key: 'archive',
          label: t('session.action.archive'),
          icon: <ArchiveIcon />,
          testId: `session-menu-archive-${session.id}`,
          invoke: onArchive,
          variant: 'destructive',
        },
      ],
    },
  ]
  const availableGroups = sessionGroups.filter(
    group => group.id !== session.sessionGroupId,
  )

  return (
    <Menu open={menuOpen} onOpenChange={onOpenChange}>
      {menuOpen && anchor
        ? (
            <MenuPopup
              align="start"
              anchor={anchor}
              side="bottom"
              sideOffset={0}
            >
              {actionGroups.map((group, groupIndex) => (
                <Fragment key={group.key}>
                  {groupIndex > 0 ? <MenuSeparator /> : null}
                  {group.actions.map(action => (
                    <MenuItem
                      key={action.key}
                      variant={action.variant}
                      onClick={() => {
                        void action.invoke()
                      }}
                      data-testid={`${action.testId}-context`}
                    >
                      {action.icon}
                      {action.label}
                    </MenuItem>
                  ))}
                </Fragment>
              ))}
              <MenuSeparator />
              {session.sessionGroupId
                ? (
                    <MenuItem onClick={onRemoveFromGroup}>
                      {t('sessionGroup.action.removeFromGroup')}
                    </MenuItem>
                  )
                : (
                    <>
                      {availableGroups.map(group => (
                        <MenuItem
                          key={group.id}
                          onClick={() => onAddToGroup(group.id)}
                        >
                          {t('sessionGroup.action.addToGroup', {
                            title: group.title,
                          })}
                        </MenuItem>
                      ))}
                      <MenuItem onClick={onCreateGroup}>
                        {t('sessionGroup.action.createAndAdd')}
                      </MenuItem>
                    </>
                  )}
            </MenuPopup>
          )
        : null}
    </Menu>
  )
}
