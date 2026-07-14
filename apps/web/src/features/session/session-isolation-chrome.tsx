import {
  GitBranchLine as GitBranchIcon,
  ShieldLine as ShieldIcon,
} from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '~/components/ui/menu'
import { toastManager } from '~/components/ui/toast'
import { OpenInPicker } from '~/features/editor/open-in-picker'
import { cn } from '~/lib/cn'
import { openChatSession } from '~/navigation/navigation-commands'

import {
  useCleanupWorktree,
  useLeaveSessionIsolation,
  useSessionIsolationState,
} from './use-session-isolation'

interface SessionIsolationChromeProps {
  sessionId: string
  workspaceId: string | null
}

export function SessionIsolationChrome({ sessionId, workspaceId }: SessionIsolationChromeProps) {
  const { t } = useTranslation('session-isolation')
  const isolationQuery = useSessionIsolationState(sessionId)
  const leaveIsolation = useLeaveSessionIsolation()
  const cleanupWorktree = useCleanupWorktree()
  const [cleanupMode, setCleanupMode] = useState<'merge-and-close' | 'abandon' | null>(null)

  const isolation = isolationQuery.data
  const unhealthy = !!(
    isolation?.worktreeId
    && isolation.worktreeHealth
    && isolation.worktreeHealth !== 'ok'
  )
  if (!isolation?.isIsolated && !isolation?.pendingWorktreeId && !unhealthy) {
    return null
  }

  const branchLabel = isolation.worktreeBranch ?? t('chrome.unknownBranch')
  const badgeLabel = unhealthy ? t('chrome.unhealthyBadge') : t('chrome.badge')

  const handleLeaveMain = async () => {
    try {
      await leaveIsolation.mutateAsync({ sessionId, workspaceId })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('chrome.errorTitle'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const handleCleanup = async () => {
    if (!cleanupMode || !workspaceId || !isolation.worktreeId) {
      return
    }
    try {
      await cleanupWorktree.mutateAsync({
        workspaceId,
        worktreeId: isolation.worktreeId,
        mode: cleanupMode,
      })
      setCleanupMode(null)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('chrome.errorTitle'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <>
      {isolation.worktreePath && (
        <OpenInPicker path={isolation.worktreePath} />
      )}
      <Menu>
        <MenuTrigger
          className={cn(
            'flex h-7 max-w-48 items-center gap-1 rounded-md border border-border/60 px-2',
            'text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          )}
          data-testid="session-isolation-badge"
        >
          <ShieldIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate font-medium text-foreground/90">{badgeLabel}</span>
          <GitBranchIcon className="size-3 shrink-0 opacity-60" aria-hidden />
          <span className="truncate opacity-70">{branchLabel}</span>
        </MenuTrigger>
        <MenuPopup align="end" className="w-56">
          <MenuGroup>
            <MenuGroupLabel>{t('chrome.menuTitle')}</MenuGroupLabel>
            <MenuItem onClick={() => void handleLeaveMain()} data-testid="session-isolation-leave">
              {t('chrome.leaveMain')}
            </MenuItem>
            <MenuItem
              onClick={() => setCleanupMode('merge-and-close')}
              data-testid="session-isolation-merge-close"
            >
              {t('chrome.mergeAndClose')}
            </MenuItem>
            <MenuItem
              onClick={() => setCleanupMode('abandon')}
              data-testid="session-isolation-abandon"
            >
              {t('chrome.abandon')}
            </MenuItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuGroupLabel>{t('chrome.siblingHint')}</MenuGroupLabel>
            <MenuItem disabled className="text-[11px] text-muted-foreground">
              {t('chrome.siblingDescription')}
            </MenuItem>
          </MenuGroup>
        </MenuPopup>
      </Menu>

      <AlertDialog open={cleanupMode !== null} onOpenChange={open => !open && setCleanupMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cleanupMode === 'merge-and-close' ? t('chrome.mergeAndClose') : t('chrome.abandon')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('chrome.cleanupWarning')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('chrome.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={cleanupWorktree.isPending}
              onClick={(event) => {
                event.preventDefault()
                void handleCleanup()
              }}
            >
              {t('chrome.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function SessionIsolationSiblingSessions({
  sessionId,
  siblingSessionIds,
}: {
  sessionId: string
  siblingSessionIds: string[]
}) {
  const { t } = useTranslation('session-isolation')
  const others = siblingSessionIds.filter(id => id !== sessionId)
  if (others.length === 0) {
    return null
  }

  return (
    <>
      {others.map(id => (
        <MenuItem key={id} onClick={() => openChatSession(id)}>
          {t('chrome.openSession', { id: id.slice(0, 8) })}
        </MenuItem>
      ))}
    </>
  )
}
