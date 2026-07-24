import {
  AlertLine as CircleAlertIcon,
  ArchiveLine as ArchiveIcon,
  CalendarTimeAddLine as CalendarClockIcon,
  ChartBar2Line as BarChart3Icon,
  Chat1Line as MessageSquarePlusIcon,
  CopyLine as ClipboardCopyIcon,
  CopyLine as CopyIcon,
  DeleteLine as Trash2Icon,
  DownloadLine as DownloadIcon,
  DownSmallLine as ChevronDownIcon,
  ExternalLinkLine as ExternalLinkIcon,
  FileNewLine as FilePlusIcon,
  FilterLine as ListFilterIcon,
  FolderLine as FolderClosedIcon,
  FolderOpenLine as FolderOpenIcon,
  GitCompareLine as FileDiffIcon,
  GitPullRequestLine as WorkIcon,
  LoadingLine,
  MailLine as MailIcon,
  MailOpenLine as MailOpenIcon,
  More2Line as MoreHorizontalIcon,
  NewFolderLine as FolderPlusIcon,
  PencilLine as PencilIcon,
  PinLine as PinIcon,
  PinLine as PinOffIcon,
  PlusLine as PlusIcon,
  Refresh1Line as RefreshCwIcon,
  SafeShieldLine as SafeShieldIcon,
  SearchLine as SearchIcon,
  Settings2Line as SettingsIcon,
  TransferVerticalLine as ArrowUpDownIcon,
  UpSmallLine as ChevronUpIcon,
  UserQuestionLine as UserQuestionIcon,
} from '@mingcute/react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { FolderSymlink as FolderSymlinkIcon } from 'lucide-react'
import {
  Fragment,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { shallow } from 'zustand/shallow'

import {
  getSessionsByIdExportMarkdown,
  patchSessionsById,
  postChatSessionsBySessionIdTitleRegenerate,
  postSessionsByIdArchive,
  postSessionsByIdRead,
  postSessionsByIdUnread,
  postWorksByIdArchive,
} from '~/api-gen'
import {
  getRemoteHostsOptions,
  getSessionsByIdQueryKey,
  getWorksByIdQueryKey,
  getWorksQueryKey,
  patchWorkspacesByWorkspaceIdLocationMutation,
  patchWorkspacesByWorkspaceIdMutation,
  postWorkspacesByWorkspaceIdFilesFileMutation,
  postWorkspacesByWorkspaceIdFilesFolderMutation,
  postWorkspacesMultiFolderMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetRemoteHostsResponse,
  PostWorkspacesMultiFolderData,
} from '~/api-gen/types.gen'
import type { RuntimeIconDescriptor } from '~/components/common/provider-icons'
import { RuntimeIcon } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '~/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '~/components/ui/menu'
import { ScrollArea } from '~/components/ui/scroll-area'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { runtimeSessionStatusQueryOptions } from '~/features/chat/commands/runtime-session-status-command'
import { prefetchChatSession } from '~/features/chat/session/chat-session-prefetch'
import { useDirectoryPicker } from '~/features/filesystem/directory-picker-provider'
import { KanbanSidebar } from '~/features/kanban/kanban-sidebar'
import { PluginsSidebar } from '~/features/plugins/plugins-sidebar'
import {
  STATUS_ICON,
  STATUS_ICON_CLASS,
  statusKind,
} from '~/features/pull-requests/status-meta'
import {
  fetchRemoteUpstreamJson,
  remoteHostUpstreamQueryKey,
} from '~/features/remote-hosts/upstream-fetch'
import { useGlobalSearchStore } from '~/features/search/global-search-store'
import { downloadSessionZip } from '~/features/session/download-session-zip'
import { SettingsGroup, SettingsPage } from '~/features/settings/settings-container'
import { SettingsRow } from '~/features/settings/settings-row'
import { useFeatureFlag } from '~/features/settings/use-app-preferences'
import type { WorkSummary } from '~/features/work/use-work'
import { useWorkspaceWorks } from '~/features/work/use-work'
import { MigrateWorkspaceDialog } from '~/features/workspace/migrate-workspace-dialog'
import { ensureRemoteWorkspaceForPath } from '~/features/workspace/remote-workspace-import'
import type { Workspace } from '~/features/workspace/types'
import { getLocalWorkspacePath, getWorkspaceLocationLabel, isLocalWorkspace } from '~/features/workspace/types'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'
import { authorizeDangerousAction, isElectron, nativeIpc } from '~/lib/electron'
import { useIsActiveSurfaceId } from '~/navigation/active-surface'
import {
  closeSurfaceById,
  openAutomation,
  openChatSession,
  openDiff,
  openNewChat,
  openNewWork,
  openPullRequests,
  openSettingsSection,
  openUsage,
  openWork,
  openWorkspaceDetail,
} from '~/navigation/navigation-commands'
import type { ScreenCoordinates } from '~/navigation/screen-coordinates'
import { getEventScreenCoordinates, isPointerOutsideWindow } from '~/navigation/screen-coordinates'
import { chatSurfaceId, workSurfaceId } from '~/navigation/surface-identity'
import { openTearoffChatSessionWindow, openTearoffSurfaceWindow } from '~/navigation/tearoff-surfaces'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { useTitleRegenerationStore } from '~/store/title-regeneration'

import { usePreviewCard } from './preview-card/preview-card-context'
import { PreviewCardProvider } from './preview-card/preview-card-provider'
import { SESSION_DRAG_MIME_TYPE } from './session-drag-data'
import { SessionRenameInput } from './session-rename-input'
import type { WorkspaceSession } from './use-session'
import { isManualSession, sessionsQueryKey, updateSessionReadState, useAllSessions } from './use-session'
import type { WorkspaceSessionGroup } from './use-session-group'
import {
  useAddSessionGroupMembers,
  useCreateSessionGroup,
  useDeleteSessionGroup,
  useRemoveSessionGroupMember,
  useSessionGroups,
  useUpdateSessionGroup,
} from './use-session-group'
import type { CreateWorkspaceInput, WorkspaceRecognition } from './use-workspace'
import {
  useAddWorkspace,
  useDeleteWorkspace,
  useToggleWorkspacePin,
  useWorkspaces,
  WORKSPACES_QUERY_KEY,
} from './use-workspace'
import {
  partitionWorkspaceSessions,
  SessionGroupMenuItems,
  WorkspaceSessionGroupSection,
} from './workspace-session-groups'
import type {
  WorkspaceSidebarProjectFilter,
  WorkspaceSidebarProjectSortDirection,
  WorkspaceSidebarProjectSortKey,
} from './workspace-sidebar-ui-store'
import { useWorkspaceSidebarUiStore } from './workspace-sidebar-ui-store'

type WorkspaceTranslation = TFunction<'workspace'>
type WorkTranslation = TFunction<'work'>

const SESSION_REVEAL_BATCH_SIZE = 64
const SESSION_REVEAL_DELAY_MS = 16
const RECENT_SESSION_WINDOW_SECONDS = 60 * 60
const DEFAULT_WORKSPACE_FILE_NAME = 'untitled'
const DEFAULT_WORKSPACE_FOLDER_NAME = 'untitled-folder'
const EMPTY_WORKSPACE_SESSIONS: WorkspaceSession[] = []
const EMPTY_SESSION_ID_SET = new Set<string>()

const PROJECT_FILTER_OPTIONS: readonly WorkspaceSidebarProjectFilter[] = [
  'all',
  'pinned',
  'unpinned',
  'unread',
  'running',
  'recent',
]
const PROJECT_SORT_OPTIONS: readonly WorkspaceSidebarProjectSortKey[] = [
  'name',
  'updatedAt',
  'createdAt',
]
const PROJECT_SORT_DIRECTION_OPTIONS: readonly WorkspaceSidebarProjectSortDirection[] = [
  'asc',
  'desc',
]

function formatToastError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  if (typeof error === 'string') {
    return error
  }
  return JSON.stringify(error)
}

function formatRegenerateTitleError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (!error || typeof error !== 'object') {
    return String(error)
  }
  const payload = error as {
    message?: unknown
    details?: {
      reason?: unknown
      providerError?: { detail?: unknown, method?: unknown }
      error?: { message?: unknown }
    }
  }
  const providerDetail
    = typeof payload.details?.providerError?.detail === 'string'
      ? payload.details.providerError.detail
      : null
  const providerMethod
    = typeof payload.details?.providerError?.method === 'string'
      ? payload.details.providerError.method
      : null
  if (providerDetail && providerMethod) {
    return `${providerMethod}: ${providerDetail}`
  }
  if (providerDetail) {
    return providerDetail
  }
  if (typeof payload.details?.error?.message === 'string') {
    return payload.details.error.message
  }
  if (typeof payload.message === 'string') {
    return payload.message
  }
  return JSON.stringify(error)
}

function isSessionRunning(
  session: WorkspaceSession,
  locallyStreamingSessionIds: Set<string>,
): boolean {
  return session.status === 'streaming' || locallyStreamingSessionIds.has(session.id)
}

type SessionAttentionKind = 'userInput' | 'toolApproval'

function useSessionAttentionBySessionId(
  sessions: readonly WorkspaceSession[],
  locallyStreamingSessionIds: Set<string>,
): Map<string, SessionAttentionKind> {
  const activeSessionIds = useMemo(
    () => sessions
      .filter(session => isSessionRunning(session, locallyStreamingSessionIds))
      .map(session => session.id),
    [locallyStreamingSessionIds, sessions],
  )
  const statusQueries = useQueries({
    queries: activeSessionIds.map(sessionId => ({
      ...runtimeSessionStatusQueryOptions(sessionId),
      staleTime: 1_000,
      refetchInterval: false as const,
      refetchIntervalInBackground: true,
    })),
  })

  return useMemo(() => {
    const attentionBySessionId = new Map<string, SessionAttentionKind>()
    statusQueries.forEach((query, index) => {
      const sessionId = activeSessionIds[index]
      if (!sessionId) {
        return
      }
      if (query.data?.status === 'waitingForUserInput') {
        attentionBySessionId.set(sessionId, 'userInput')
        return
      }
      if (query.data?.status === 'waitingForToolApproval') {
        attentionBySessionId.set(sessionId, 'toolApproval')
      }
    })
    return attentionBySessionId
  }, [activeSessionIds, statusQueries])
}

function isSessionRecent(session: WorkspaceSession, currentUnixTimestamp: number): boolean {
  return session.listActivityAt >= currentUnixTimestamp - RECENT_SESSION_WINDOW_SECONDS
}

function formatRelativeTime(unixTimestamp: number, t: WorkspaceTranslation): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - unixTimestamp
  if (diff < 60) {
    return t('session.relative.now')
  }
  if (diff < 3600) {
    return t('session.relative.minutes', { count: Math.floor(diff / 60) })
  }
  if (diff < 86400) {
    return t('session.relative.hours', { count: Math.floor(diff / 3600) })
  }
  if (diff < 2592000) {
    return t('session.relative.days', { count: Math.floor(diff / 86400) })
  }
  return t('session.relative.months', { count: Math.floor(diff / 2592000) })
}

type SessionMenuAction = {
  key: string
  label: string
  icon: React.ReactNode
  testId: string
  invoke: () => void | Promise<void>
  variant?: 'default' | 'destructive'
}

type SessionMenuActionGroup = {
  key: string
  actions: SessionMenuAction[]
}

type WorkspaceMenuAction = {
  key: string
  label: string
  icon: React.ReactNode
  testId: string
  invoke: () => void | Promise<void>
  variant?: 'default' | 'destructive'
  separatorBefore?: boolean
}

type SessionMenuAnchor
  = | HTMLElement
    | {
      getBoundingClientRect: () => DOMRect
    }

type RuntimeIconByKind = ReadonlyMap<RuntimeKind, RuntimeIconDescriptor>

type SessionMenuRequest = {
  sessionId: string
  workId: string | null
  anchor: SessionMenuAnchor
}

type SessionMenuState = {
  open: boolean
  sessionId: string | null
  workId: string | null
  anchor: SessionMenuAnchor | null
}

const CLOSED_SESSION_MENU_STATE: SessionMenuState = {
  open: false,
  sessionId: null,
  workId: null,
  anchor: null,
}

function createPointMenuAnchor(clientX: number, clientY: number): SessionMenuAnchor {
  return {
    getBoundingClientRect: () => new DOMRect(clientX, clientY, 0, 0),
  }
}

function SessionMenuActionItems({
  groups,
  testIdSurface = 'button',
}: {
  groups: SessionMenuActionGroup[]
  testIdSurface?: 'button' | 'context'
}) {
  return groups.map((group, groupIndex) => (
    <Fragment key={group.key}>
      {groupIndex > 0 && <MenuSeparator />}
      {group.actions.map(action => (
        <MenuItem
          key={action.key}
          variant={action.variant}
          onClick={() => {
            void action.invoke()
          }}
          data-testid={
            testIdSurface === 'context' ? `${action.testId}-context` : action.testId
          }
        >
          {action.icon}
          {action.label}
        </MenuItem>
      ))}
    </Fragment>
  ))
}

function SessionActionsMenu({
  state,
  session,
  work,
  workspaceId,
  sessionGroups,
  onOpenChange,
  onPrepareSessionOpen,
  onStartRename,
  onAddSessionToGroup,
  onRemoveSessionFromGroup,
  onCreateSessionGroupFromSession,
}: {
  state: SessionMenuState
  session: WorkspaceSession | null
  work: WorkSummary | null
  workspaceId: string
  sessionGroups: WorkspaceSessionGroup[]
  onOpenChange: (open: boolean) => void
  onPrepareSessionOpen: (session: WorkspaceSession) => void
  onStartRename: (sessionId: string) => void
  onAddSessionToGroup: (sessionId: string, groupId: string) => void
  onRemoveSessionFromGroup: (session: WorkspaceSession) => void
  onCreateSessionGroupFromSession: (session: WorkspaceSession) => void
}) {
  const { t } = useTranslation('workspace')
  const queryClient = useQueryClient()
  const open = state.open && state.anchor !== null && session !== null

  const invalidateSessionQueries = useCallback(async () => {
    if (!session) {
      return
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getSessionsByIdQueryKey({ path: { id: session.id } }),
      }),
      queryClient.invalidateQueries({ queryKey: getWorksQueryKey() }),
      ...(work
        ? [queryClient.invalidateQueries({
            queryKey: getWorksByIdQueryKey({ path: { id: work.id } }),
          })]
        : []),
    ])
  }, [queryClient, session, work, workspaceId])

  const handleOpenInNewTab = useCallback(() => {
    if (!session) {
      return
    }

    if (work) {
      openWork(work.id)
      return
    }
    openChatSession(session.id)
  }, [session, work])

  const handleOpenInNewWindow = useCallback(() => {
    if (!session) {
      return
    }

    onPrepareSessionOpen(session)
    const screenX = window.screenX + Math.round(window.outerWidth / 2)
    const screenY = window.screenY + Math.round(window.outerHeight / 2)
    if (work) {
      void openTearoffSurfaceWindow({
        id: workSurfaceId(work.id),
        kind: 'work',
        title: work.title,
        route: { to: '/work/$workId', params: { workId: work.id } },
        order: 0,
        closable: true,
      }, { screenX, screenY, detachSurface: true })
      return
    }
    void openTearoffChatSessionWindow(session.id, { screenX, screenY, detachSurface: true })
  }, [onPrepareSessionOpen, session, work])

  const handleStartRename = useCallback(() => {
    if (!session) {
      return
    }

    onOpenChange(false)
    onStartRename(session.id)
  }, [onOpenChange, onStartRename, session])

  const handleRegenerateTitle = useCallback(async () => {
    if (!session) {
      return
    }

    const { beginRegeneration, endRegeneration } = useTitleRegenerationStore.getState()
    beginRegeneration(session.id)
    try {
      const { error } = await postChatSessionsBySessionIdTitleRegenerate({
        path: { sessionId: session.id },
      })
      if (error) {
        throw error
      }
      await invalidateSessionQueries()
    }
 catch (error) {
      toastManager.add({
        type: 'error',
        title: t('session.toast.regenerateTitleFailed'),
        description: formatRegenerateTitleError(error),
      })
    }
 finally {
      endRegeneration(session.id)
    }
  }, [invalidateSessionQueries, session, t])

  const handleToggleReadState = useCallback(async () => {
    if (!session) {
      return
    }

    const { data } = session.unread
      ? await postSessionsByIdRead({ path: { id: session.id } })
      : await postSessionsByIdUnread({ path: { id: session.id } })
    if (data) {
      updateSessionReadState(queryClient, data)
    }
  }, [queryClient, session])

  const handleTogglePin = useCallback(async () => {
    if (!session) {
      return
    }

    await patchSessionsById({ path: { id: session.id }, body: { pinned: !session.pinned } })
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
    ])
  }, [queryClient, session, workspaceId])

  const handleExport = useCallback(async () => {
    if (!session) {
      return
    }

    const { data } = await getSessionsByIdExportMarkdown({ path: { id: session.id } })
    const md = (data as { markdown?: string } | null)?.markdown
    if (md) {
      await navigator.clipboard.writeText(md)
    }
  }, [session])

  const handleExportZip = useCallback(async () => {
    if (!session) {
      return
    }
    try {
      await downloadSessionZip(session.id)
    }
    catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'session-export-busy') {
        toastManager.add({ type: 'error', title: t('session.toast.exportZipBusy') })
      }
      else {
        toastManager.add({ type: 'error', title: t('session.toast.exportZipFailed') })
      }
    }
  }, [session, t])

  const handleArchive = useCallback(async () => {
    if (!session) {
      return
    }

    if (work) {
      await postWorksByIdArchive({ path: { id: work.id }, body: { archived: true } })
    }
    else {
      await postSessionsByIdArchive({ path: { id: session.id }, body: { archived: true } })
    }

    const surfaceId = work ? workSurfaceId(work.id) : chatSurfaceId(session.id)
    closeSurfaceById(surfaceId)

    if (isElectron) {
      void nativeIpc?.window.closeSurface(surfaceId).catch(() => {})
    }

    await invalidateSessionQueries()
  }, [invalidateSessionQueries, session, work])

  const actionGroups = useMemo<SessionMenuActionGroup[]>(() => {
    if (!session) {
      return []
    }

    const openActions: SessionMenuAction[] = [
      {
        key: 'open-surface',
        label: t('session.action.openInSurface'),
        icon: <PlusIcon />,
        testId: `session-menu-open-surface-${session.id}`,
        invoke: handleOpenInNewTab,
      },
    ]
    if (isElectron) {
      openActions.push({
        key: 'open-new-window',
        label: t('session.action.openInNewWindow'),
        icon: <ExternalLinkIcon />,
        testId: `session-menu-open-new-window-${session.id}`,
        invoke: handleOpenInNewWindow,
      })
    }

    const copyActions: SessionMenuAction[] = [
      {
        key: 'copy-markdown',
        label: t('session.action.copyMarkdown'),
        icon: <ClipboardCopyIcon />,
        testId: `session-menu-copy-markdown-${session.id}`,
        invoke: handleExport,
      },
      {
        key: 'export-zip',
        label: t('session.action.exportZip'),
        icon: <DownloadIcon />,
        testId: `session-menu-export-zip-${session.id}`,
        invoke: handleExportZip,
      },
    ]
    if (import.meta.env.DEV) {
      copyActions.push({
        key: 'copy-session-id',
        label: t('session.action.copySessionId'),
        icon: <CopyIcon />,
        testId: `session-menu-copy-session-id-${session.id}`,
        invoke: () => {
          navigator.clipboard.writeText(session.id)
        },
      })
    }

    return [
      { key: 'open', actions: openActions },
      {
        key: 'edit',
        actions: [
          {
            key: 'rename',
            label: t('session.action.rename'),
            icon: <PencilIcon />,
            testId: `session-menu-rename-${session.id}`,
            invoke: handleStartRename,
          },
          {
            key: 'regenerate-title',
            label: t('session.action.regenerateTitle'),
            icon: <RefreshCwIcon />,
            testId: `session-menu-regenerate-title-${session.id}`,
            invoke: handleRegenerateTitle,
          },
        ],
      },
      {
        key: 'state',
        actions: [
          {
            key: 'toggle-read-state',
            label: session.unread ? t('session.action.markRead') : t('session.action.markUnread'),
            icon: session.unread ? <MailOpenIcon /> : <MailIcon />,
            testId: `session-menu-toggle-read-state-${session.id}`,
            invoke: handleToggleReadState,
          },
          {
            key: 'toggle-pin',
            label: session.pinned ? t('session.action.unpin') : t('session.action.pin'),
            icon: session.pinned ? <PinOffIcon /> : <PinIcon />,
            testId: `session-menu-toggle-pin-${session.id}`,
            invoke: handleTogglePin,
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
            invoke: handleArchive,
            variant: 'destructive',
          },
        ],
      },
    ]
  }, [
    handleArchive,
    handleExport,
    handleExportZip,
    handleOpenInNewTab,
    handleOpenInNewWindow,
    handleRegenerateTitle,
    handleStartRename,
    handleTogglePin,
    handleToggleReadState,
    session,
    t,
  ])

  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      {open && state.anchor
? (
        <MenuPopup
          align="start"
          anchor={state.anchor}
          side="bottom"
          sideOffset={0}
        >
          <SessionMenuActionItems groups={actionGroups} testIdSurface="context" />
          {session
            ? (
                <SessionGroupMenuItems
                  session={session}
                  groups={sessionGroups}
                  t={t}
                  onAddToGroup={groupId => onAddSessionToGroup(session.id, groupId)}
                  onRemoveFromGroup={() => onRemoveSessionFromGroup(session)}
                  onCreateGroup={() => onCreateSessionGroupFromSession(session)}
                />
              )
            : null}
        </MenuPopup>
      )
: null}
    </Menu>
  )
}

function WorkspaceMenuActionItems({
  actions,
  surface,
}: {
  actions: WorkspaceMenuAction[]
  surface: 'button' | 'context'
}) {
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
          {action.separatorBefore && <ContextMenuSeparator />}
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
        {action.separatorBefore && <MenuSeparator />}
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

function WorkspaceTextInputDialog({
  open,
  title,
  initialValue,
  label,
  confirmLabel,
  onOpenChange,
  onCommit,
}: {
  open: boolean
  title: string
  initialValue: string
  label: string
  confirmLabel: string
  onOpenChange: (open: boolean) => void
  onCommit: (value: string) => Promise<void>
}) {
  const { t } = useTranslation('workspace')
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) {
      setValue(initialValue)
    }
  }, [initialValue, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void onCommit(value)
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={event => setValue(event.currentTarget.value)}
            onFocus={event => event.currentTarget.select()}
            aria-label={label}
          />
          <DialogFooter variant="bare">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('workspace.dialog.cancel')}
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type MultiFolderWorkspaceBody = PostWorkspacesMultiFolderData['body']
type MultiFolderWorkspaceFolder = MultiFolderWorkspaceBody['folders'][number]
type MultiFolderWorkspaceFolderDraft = MultiFolderWorkspaceFolder & { id: string }

function createMultiFolderWorkspaceFolderDraft(): MultiFolderWorkspaceFolderDraft {
  return {
    id: `${Date.now()}-${Math.random()}`,
    name: '',
    path: '',
  }
}

function normalizeMultiFolderWorkspaceFolders(
  rows: MultiFolderWorkspaceFolderDraft[],
): MultiFolderWorkspaceFolder[] | null {
  const folders = rows.map(row => ({
    name: row.name.trim(),
    path: row.path.trim(),
  }))

  if (
    folders.length === 0
    || folders.some(folder => !folder.name || !folder.path.startsWith('/'))
  ) {
    return null
  }

  return folders
}

function WorkspaceMultiFolderDialog({
  open,
  creating,
  onOpenChange,
  onCommit,
}: {
  open: boolean
  creating: boolean
  onOpenChange: (open: boolean) => void
  onCommit: (input: MultiFolderWorkspaceBody) => Promise<void>
}) {
  const { t } = useTranslation('workspace')
  const { selectDirectory } = useDirectoryPicker()
  const [name, setName] = useState('')
  const [folderRows, setFolderRows] = useState<MultiFolderWorkspaceFolderDraft[]>(() => [
    createMultiFolderWorkspaceFolderDraft(),
  ])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setFolderRows([createMultiFolderWorkspaceFolderDraft()])
      setError(null)
    }
  }, [open])

  const updateFolderRow = useCallback((id: string, patch: Partial<MultiFolderWorkspaceFolder>) => {
    setFolderRows(rows => rows.map(row => (row.id === id ? { ...row, ...patch } : row)))
    setError(null)
  }, [])

  const addFolderRow = useCallback(() => {
    setFolderRows(rows => [...rows, createMultiFolderWorkspaceFolderDraft()])
    setError(null)
  }, [])

  const removeFolderRow = useCallback((id: string) => {
    setFolderRows((rows) => {
      if (rows.length === 1) {
        return rows
      }
      return rows.filter(row => row.id !== id)
    })
    setError(null)
  }, [])

  const browseFolderPath = useCallback(
    async (id: string) => {
      const path = await selectDirectory({
        title: t('workspace.dialog.multiFolderBrowseTitle'),
        description: t('workspace.dialog.multiFolderBrowseDescription'),
      })
      if (!path) {
        return
      }
      updateFolderRow(id, { path })
    },
    [selectDirectory, t, updateFolderRow],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">{t('workspace.dialog.multiFolderTitle')}</DialogTitle>
        <form
          className="grid gap-0"
          onSubmit={(event) => {
            event.preventDefault()
            const workspaceName = name.trim()
            const folders = normalizeMultiFolderWorkspaceFolders(folderRows)
            if (!workspaceName || !folders) {
              setError(t('workspace.toast.multiFolderInvalidEntry'))
              return
            }
            const folderNames = new Set(folders.map(folder => folder.name))
            if (folderNames.size !== folders.length) {
              setError(t('workspace.toast.multiFolderDuplicateName'))
              return
            }
            void onCommit({ name: workspaceName, folders })
          }}
        >
          <SettingsPage
            title={t('workspace.dialog.multiFolderTitle')}
            description={t('workspace.dialog.multiFolderDescription')}
            className="max-w-none gap-5 px-5 pt-5 pb-4"
          >
            <SettingsGroup>
              <SettingsRow
                label={t('workspace.dialog.nameLabel')}
                description={t('workspace.dialog.multiFolderNameDescription')}
              >
                <Input
                  id="multi-folder-workspace-name"
                  autoFocus
                  value={name}
                  onChange={(event) => {
                    setName(event.currentTarget.value)
                    setError(null)
                  }}
                  placeholder={t('workspace.dialog.multiFolderNamePlaceholder')}
                  className="h-8 w-64"
                />
              </SettingsRow>

              <SettingsRow
                label={t('workspace.dialog.multiFolderEntriesLabel')}
                description={t('workspace.dialog.multiFolderEntriesDescription')}
                vertical
              >
                <div id="multi-folder-workspace-folders" className="grid gap-2">
                  {folderRows.map((row, index) => (
                    <div
                      key={row.id}
                      className="grid gap-2 rounded-lg bg-muted/40 p-2 sm:grid-cols-[minmax(7rem,0.42fr)_minmax(0,1fr)_2rem_2rem]"
                    >
                      <Input
                        id={`multi-folder-name-${row.id}`}
                        aria-label={t('workspace.dialog.multiFolderFolderNameLabel')}
                        value={row.name}
                        onChange={event =>
                          updateFolderRow(row.id, { name: event.currentTarget.value })}
                        placeholder={
                          index === 0
                            ? t('workspace.dialog.multiFolderFolderNamePlaceholder')
                            : undefined
                        }
                        className="h-8 bg-background"
                      />
                      <Input
                        id={`multi-folder-path-${row.id}`}
                        aria-label={t('workspace.dialog.multiFolderFolderPathLabel')}
                        value={row.path}
                        onChange={event =>
                          updateFolderRow(row.id, { path: event.currentTarget.value })}
                        placeholder={
                          index === 0
                            ? t('workspace.dialog.multiFolderFolderPathPlaceholder')
                            : undefined
                        }
                        className="h-8 bg-background font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t('workspace.dialog.multiFolderBrowseFolder')}
                        onClick={() => void browseFolderPath(row.id)}
                      >
                        <FolderOpenIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('workspace.dialog.multiFolderRemoveFolder')}
                        disabled={folderRows.length === 1}
                        onClick={() => removeFolderRow(row.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={addFolderRow}
                  >
                    <PlusIcon data-icon="inline-start" />
                    {t('workspace.dialog.multiFolderAddFolder')}
                  </Button>
                </div>
              </SettingsRow>
            </SettingsGroup>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                <p>{error}</p>
              </div>
            )}
          </SettingsPage>

          <DialogFooter variant="bare" className="border-t px-5 py-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('workspace.dialog.cancel')}
            </Button>
            <Button type="submit" disabled={creating}>
              {creating && <LoadingLine className="animate-spin" />}
              {t('workspace.dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function WorkspaceRecognitionDialog({
  recognition,
  busy,
  onOpenChange,
  onOpenAsCradleWorkspace,
  onAddAsSingleFolder,
}: {
  recognition: WorkspaceRecognition | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onOpenAsCradleWorkspace: () => Promise<void>
  onAddAsSingleFolder: () => Promise<void>
}) {
  const { t } = useTranslation('workspace')
  const open = recognition !== null
  const inspection = recognition?.inspection
  const invalid = inspection ? !inspection.configValid : false
  const needsFlagEnable = inspection ? !inspection.featureFlagEnabled : false
  const alreadyImported = inspection?.alreadyImported ?? false
  const config = inspection?.config ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>
            {invalid
              ? t('workspace.dialog.recognitionInvalidTitle')
              : t('workspace.dialog.recognitionTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 px-5 pb-4">
          <p className="text-sm text-muted-foreground">
            {invalid
              ? t('workspace.dialog.recognitionInvalidDescription')
              : t('workspace.dialog.recognitionDescription')}
          </p>

          {invalid && inspection?.configError && (
            <pre className="max-h-24 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-xs text-muted-foreground">
              {inspection.configError}
            </pre>
          )}

          {config && !invalid && (
            <SettingsGroup>
              <SettingsRow
                label={t('workspace.dialog.recognitionNameLabel')}
              >
                <span className="text-sm font-medium">{config.name}</span>
              </SettingsRow>
              <SettingsRow
                label={t('workspace.dialog.recognitionFoldersLabel')}
                vertical
              >
                <ul className="grid gap-1">
                  {config.folders.map(folder => (
                    <li
                      key={`${folder.name}:${folder.path}`}
                      className="grid grid-cols-[minmax(5rem,0.3fr)_minmax(0,1fr)] gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-xs"
                    >
                      <span className="font-medium">{folder.name}</span>
                      <span className="truncate font-mono text-muted-foreground" title={folder.path}>
                        {folder.path}
                      </span>
                    </li>
                  ))}
                </ul>
              </SettingsRow>
            </SettingsGroup>
          )}

          {needsFlagEnable && !invalid && (
            <p className="text-xs text-muted-foreground">
              {t('workspace.dialog.recognitionExperimentalNote')}
            </p>
          )}
          {alreadyImported && (
            <p className="text-xs text-muted-foreground">
              {t('workspace.dialog.recognitionAlreadyImported')}
            </p>
          )}
        </div>
        <DialogFooter variant="bare" className="border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('workspace.dialog.cancel')}
          </Button>
          {!invalid && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void onOpenAsCradleWorkspace()}
            >
              {busy && <LoadingLine className="animate-spin" />}
              {needsFlagEnable
                ? t('workspace.dialog.recognitionOpenExperimental')
                : t('workspace.dialog.recognitionOpen')}
            </Button>
          )}
          <Button
            type="button"
            variant={invalid ? 'default' : 'ghost'}
            disabled={busy}
            onClick={() => void onAddAsSingleFolder()}
          >
            {t('workspace.dialog.recognitionAddSingle')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type RemoteHost = GetRemoteHostsResponse[number]

interface RemoteWorkspace {
  id: string
  name: string
  locator: {
    hostId: string
    path: string
    kind?: 'project' | 'managed-worktree'
    sourceWorkspaceId?: string | null
  }
  gitIdentity: {
    originUrl?: string | null
    repoRoot?: string | null
    headSha?: string | null
    branch?: string | null
  }
  identifier: string
  pinned: number
  createdAt: number
  updatedAt: number
}

interface RemoteWorkspaceFileEntry {
  type: 'file' | 'directory'
  name: string
  path: string
}

function remoteHostWorkspacesQueryKey(hostId: string) {
  return remoteHostUpstreamQueryKey(hostId, 'workspaces')
}

function remoteHostFilesQueryKey(hostId: string, workspaceId: string) {
  return remoteHostUpstreamQueryKey(hostId, workspaceId, 'files')
}

function RemoteWorkspaceFileRow({ entry }: { entry: RemoteWorkspaceFileEntry }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0">
      {entry.type === 'directory'
        ? <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        : <FilePlusIcon className="size-3.5 shrink-0 text-muted-foreground/45" aria-hidden="true" />}
      <span className="truncate text-[11.5px] text-foreground/80">{entry.name}</span>
    </div>
  )
}

function RemoteWorkspaceCard({
  workspace,
  selected,
  onSelect,
}: {
  workspace: RemoteWorkspace
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-1 border-b border-border/40 px-2.5 py-2 text-left last:border-b-0 hover:bg-muted/40',
        selected && 'bg-muted/50',
      )}
    >
      <span className="truncate text-[11.5px] font-medium text-foreground/85">{workspace.name}</span>
      <span className="truncate font-mono text-[10.5px] text-muted-foreground/70">{workspace.locator.path}</span>
      {workspace.gitIdentity.branch && (
        <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
          <FileDiffIcon className="size-3" aria-hidden="true" />
          {workspace.gitIdentity.branch}
        </span>
      )}
    </button>
  )
}

function RemoteWorkspaceBrowser({
  host,
  creating,
  onCreate,
}: {
  host: RemoteHost
  creating: boolean
  onCreate: (input: CreateWorkspaceInput) => Promise<void>
}) {
  const { t } = useTranslation(['workspace', 'settings'])
  const { selectDirectory } = useDirectoryPicker()
  const queryClient = useQueryClient()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [importingPath, setImportingPath] = useState(false)

  const workspacesQuery = useQuery({
    queryKey: remoteHostWorkspacesQueryKey(host.id),
    queryFn: () => fetchRemoteUpstreamJson<RemoteWorkspace[]>(host.id, '/workspaces'),
    retry: false,
  })
  const workspaces = workspacesQuery.data ?? []
  const selectedWorkspace = useMemo(() => {
    return workspaces.find(workspace => workspace.id === selectedWorkspaceId) ?? workspaces[0] ?? null
  }, [selectedWorkspaceId, workspaces])

  useEffect(() => {
    setSelectedWorkspaceId(null)
  }, [host.id])

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length > 0) {
      setSelectedWorkspaceId(workspaces[0].id)
    }
  }, [selectedWorkspaceId, workspaces])

  const filesQuery = useQuery({
    queryKey: remoteHostFilesQueryKey(host.id, selectedWorkspace?.id ?? ''),
    queryFn: () => fetchRemoteUpstreamJson<RemoteWorkspaceFileEntry[]>(
      host.id,
      `/workspaces/${encodeURIComponent(selectedWorkspace?.id ?? '')}/files`,
    ),
    enabled: !!selectedWorkspace,
    retry: false,
  })

  const busy = creating || importingPath

  const handleMountExisting = async () => {
    if (!selectedWorkspace) {
      return
    }

    await onCreate({
      name: selectedWorkspace.name,
      locator: {
        hostId: host.id,
        path: selectedWorkspace.locator.path,
        kind: selectedWorkspace.locator.kind,
        sourceWorkspaceId: selectedWorkspace.id,
      },
      gitIdentity: selectedWorkspace.gitIdentity,
    })
  }

  const handleBrowseAndImport = async () => {
    setImportingPath(true)
    try {
      const path = await selectDirectory({
        hostId: host.id,
        title: t('workspace.dialog.remoteBrowseTitle'),
        description: t('workspace.dialog.remoteBrowseDescription', { hostName: host.displayName }),
      })
      if (!path) {
        return
      }
      const input = await ensureRemoteWorkspaceForPath(host.id, path)
      await onCreate(input)
      void queryClient.invalidateQueries({ queryKey: remoteHostWorkspacesQueryKey(host.id) })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.toast.remoteWorkspaceCreateFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
    finally {
      setImportingPath(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/60 px-3 py-2.5">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[12px] font-medium text-foreground/90">
            {t('workspace.dialog.remoteBrowseTitle')}
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('workspace.dialog.remoteBrowseHint', { hostName: host.displayName })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={busy || host.connectionState !== 'connected'}
          onClick={() => void handleBrowseAndImport()}
        >
          {importingPath
            ? <LoadingLine className="animate-spin" />
            : <FolderPlusIcon className="size-3.5" />}
          {t('workspace.dialog.remoteBrowseAction')}
        </Button>
      </div>

      {workspacesQuery.isLoading
        ? (
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
              <LoadingLine className="size-3 animate-spin" />
              {t('settings:remoteHosts.loading')}
            </div>
          )
        : workspacesQuery.isError
          ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                {workspacesQuery.error instanceof Error ? workspacesQuery.error.message : String(workspacesQuery.error)}
              </p>
            )
          : workspaces.length === 0
            ? (
                <p className="rounded-md border border-dashed border-border/70 px-2.5 py-3 text-center text-[11px] text-muted-foreground">
                  {t('workspace.dialog.remoteNoExistingWorkspaces')}
                </p>
              )
            : (
                <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div className="min-h-0 overflow-y-auto rounded-md border border-border/60">
                    <p className="sticky top-0 border-b border-border/50 bg-muted/30 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      {t('workspace.dialog.remoteExistingLabel')}
                    </p>
                    {workspaces.map(workspace => (
                      <RemoteWorkspaceCard
                        key={workspace.id}
                        workspace={workspace}
                        selected={selectedWorkspace?.id === workspace.id}
                        onSelect={() => setSelectedWorkspaceId(workspace.id)}
                      />
                    ))}
                  </div>

                  <div className="min-w-0 space-y-3">
                    {selectedWorkspace && (
                      <div className="space-y-2 rounded-lg border border-border/70 bg-card/60 p-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium uppercase text-muted-foreground/70">
                            {t('workspace.dialog.selectedWorkspace')}
                          </p>
                          <p className="truncate font-mono text-[11.5px] text-foreground/80" title={selectedWorkspace.locator.path}>
                            {selectedWorkspace.locator.path}
                          </p>
                        </div>
                        {selectedWorkspace.gitIdentity.originUrl && (
                          <p className="break-all font-mono text-[11px] text-muted-foreground/80">
                            {selectedWorkspace.gitIdentity.originUrl}
                          </p>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => void handleMountExisting()}
                        >
                          {creating && !importingPath && <LoadingLine className="animate-spin" />}
                          {t('workspace.dialog.remoteMountExisting')}
                        </Button>
                      </div>
                    )}

                    {filesQuery.isLoading
                      ? (
                          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
                            <LoadingLine className="size-3 animate-spin" />
                            {t('workspace.dialog.loadingFiles')}
                          </div>
                        )
                      : filesQuery.isError
                        ? (
                            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                              {filesQuery.error instanceof Error ? filesQuery.error.message : String(filesQuery.error)}
                            </p>
                          )
                        : filesQuery.data && filesQuery.data.length > 0
                          ? (
                              <div className="max-h-56 overflow-y-auto rounded-md border border-border/60">
                                {filesQuery.data.map(entry => (
                                  <RemoteWorkspaceFileRow key={entry.path} entry={entry} />
                                ))}
                              </div>
                            )
                          : selectedWorkspace
                            ? (
                                <p className="rounded-md border border-dashed border-border/70 px-2.5 py-3 text-center text-[11px] text-muted-foreground">
                                  {t('settings:remoteHosts.files.empty')}
                                </p>
                              )
                            : null}
                  </div>
                </div>
              )}
    </div>
  )
}

function WorkspaceAddDialog({
  open,
  creating,
  onOpenChange,
  onAddLocal,
  onCreateRemote,
}: {
  open: boolean
  creating: boolean
  onOpenChange: (open: boolean) => void
  onAddLocal: () => void
  onCreateRemote: (input: CreateWorkspaceInput) => Promise<void>
}) {
  const { t } = useTranslation(['workspace', 'settings'])
  const [selectedHostId, setSelectedHostId] = useState('local')
  const { data: remoteHosts = [], isLoading } = useQuery({
    ...getRemoteHostsOptions(),
    enabled: open,
  })
  const selectedRemoteHost = remoteHosts.find(host => host.id === selectedHostId) ?? null

  useEffect(() => {
    if (!open) {
      setSelectedHostId('local')
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>
            {t('workspace.dialog.addWorkspaceTitle', { defaultValue: 'Add workspace' })}
          </DialogTitle>
        </DialogHeader>
        <div className="grid min-h-96 grid-cols-[12rem_minmax(0,1fr)] border-t border-border/60">
          <div className="border-r border-border/60 bg-muted/20 p-2">
            <button
              type="button"
              onClick={() => setSelectedHostId('local')}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors',
                selectedHostId === 'local'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <FolderOpenIcon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {t('workspace.dialog.addWorkspaceLocalHost', { defaultValue: 'This Mac' })}
              </span>
            </button>
            <div className="mt-2 border-t border-border/60 pt-2">
              <p className="px-2.5 pb-1 text-[10px] font-medium uppercase text-muted-foreground/60">
                {t('settings:remoteHosts.page.title')}
              </p>
              {isLoading
                ? (
                    <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-muted-foreground">
                      <LoadingLine className="size-3 animate-spin" />
                      {t('settings:remoteHosts.loading')}
                    </div>
                  )
                : remoteHosts.length === 0
                  ? (
                      <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                        {t('workspace.dialog.addWorkspaceNoRemoteHosts', { defaultValue: 'No remote hosts configured.' })}
                      </p>
                    )
                  : remoteHosts.map((host) => {
                      const connected = host.connectionState === 'connected'
                      return (
                        <button
                          key={host.id}
                          type="button"
                          disabled={!connected}
                          onClick={() => setSelectedHostId(host.id)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                            selectedHostId === host.id
                              ? 'bg-accent text-foreground'
                              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                          )}
                        >
                          <ArrowUpDownIcon className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{host.displayName}</span>
                          <span className={cn('size-1.5 shrink-0 rounded-full', connected ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                        </button>
                      )
                    })}
            </div>
          </div>

          <div className="min-w-0 p-4">
            {selectedHostId === 'local'
              ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                    <div className="flex size-12 items-center justify-center rounded-xl bg-muted/60">
                      <FolderOpenIcon className="size-6 text-muted-foreground/70" aria-hidden="true" />
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="text-sm font-medium">
                        {t('workspace.dialog.addWorkspaceLocalTitle', { defaultValue: 'Choose a local project folder' })}
                      </h3>
                      <p className="mx-auto max-w-xs text-[12px] leading-relaxed text-muted-foreground">
                        {t('workspace.dialog.addWorkspaceLocalDescription', { defaultValue: 'Local workspaces use this machine as host and keep your files where they are.' })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      disabled={creating}
                      onClick={() => {
                        onOpenChange(false)
                        onAddLocal()
                      }}
                    >
                      <FolderPlusIcon className="size-3.5" />
                      {t('workspace.dialog.addWorkspaceChooseLocal', { defaultValue: 'Choose folder' })}
                    </Button>
                  </div>
                )
              : selectedRemoteHost
                ? (
                    <RemoteWorkspaceBrowser
                      key={selectedRemoteHost.id}
                      host={selectedRemoteHost}
                      creating={creating}
                      onCreate={onCreateRemote}
                    />
                  )
                : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const SessionActiveBackground = memo(({ active }: { active: boolean }) => {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 rounded-lg transition-colors',
        active ? 'bg-accent/80' : 'bg-transparent',
      )}
      aria-hidden="true"
      data-session-active={active ? 'true' : 'false'}
    />
  )
})
SessionActiveBackground.displayName = 'SessionActiveBackground'

const SessionUnreadIndicator = memo(
  ({ show, active, label }: { show: boolean, active: boolean, label: string }) => {
    if (!show || active) {
      return null
    }

    return <span className="shrink-0 size-1.5 rounded-full bg-primary" aria-label={label} />
  },
)
SessionUnreadIndicator.displayName = 'SessionUnreadIndicator'

// ── Session item ──────────────────────────────────────────────────────────────

const SessionItem = memo(
  ({
    session,
    work,
    isStreaming,
    attentionKind,
    hasError,
    isRenaming,
    runtimeIcon,
    t,
    tWork,
    onPrepareSessionOpen,
    onPrefetchSession,
    onRenameCommit,
    onRenameCancel,
    onOpenSessionMenu,
  }: {
    session: WorkspaceSession
    work: WorkSummary | null
    isStreaming: boolean
    attentionKind: SessionAttentionKind | null
    hasError: boolean
    isRenaming: boolean
    runtimeIcon: RuntimeIconDescriptor | undefined
    t: WorkspaceTranslation
    tWork: WorkTranslation
    onPrepareSessionOpen: (session: WorkspaceSession) => void
    onPrefetchSession: (sessionId: string) => void
    onRenameCommit: (session: WorkspaceSession, nextTitle: string) => Promise<void>
    onRenameCancel: () => void
    onOpenSessionMenu: (request: SessionMenuRequest) => void
  }) => {
    const previewCard = usePreviewCard()
    const sessionSurfaceId = work ? workSurfaceId(work.id) : chatSurfaceId(session.id)
    const active = useIsActiveSurfaceId(sessionSurfaceId)
    const isUnread = session.unread
    // System-generated sessions (anything other than `manual`) are always
    // de-emphasized so they don't compete with the user's own chats.
    // Running/error/unread states only affect the right-side indicators,
    // not the row opacity. The exception is the currently active session.
    const isManual = isManualSession(session)
    const dimmed = !work && !isManual && !active
    const isRegeneratingTitle = useTitleRegenerationStore(state =>
      state.regeneratingSessionIds.has(session.id))
    const dragScreenPointerRef = useRef<ScreenCoordinates | null>(null)
    const dragCleanupRef = useRef<(() => void) | null>(null)
    const dragWasTornOffRef = useRef(false)
    const sessionTitle = session.title?.trim() || work?.title || t('session.fallbackTitle')
    const workActivityLabel = work ? tWork(`aside.activity.${work.activity}`) : null
    const workPullRequestLabel = work?.pullRequest
      ? work.pullRequest.merged
        ? tWork('sidebar.merged', { number: work.pullRequest.number })
        : work.pullRequest.isDraft
          ? tWork('sidebar.draft', { number: work.pullRequest.number })
          : tWork('sidebar.ready', { number: work.pullRequest.number })
      : null
    const workPullRequestStatus = work?.pullRequest ? statusKind(work.pullRequest) : null
    const WorkLeadingIcon = workPullRequestStatus ? STATUS_ICON[workPullRequestStatus] : WorkIcon
    const workLeadingIconClass = workPullRequestStatus
      ? STATUS_ICON_CLASS[workPullRequestStatus]
      : 'text-muted-foreground'
    const workActivityDotClass
      = work?.activity === 'blocked'
        ? 'bg-destructive'
        : work?.activity === 'waiting'
          ? 'bg-warning'
          : null
    const workStateLabel = work && workActivityLabel
      ? workPullRequestLabel
        ? work.activity === 'idle'
          ? workPullRequestLabel
          : `${workPullRequestLabel} · ${workActivityLabel}`
        : workActivityLabel
      : null
    const trailingIndicator = isStreaming
      ? attentionKind === 'userInput'
        ? (
            <span
              className="grid size-3.5 shrink-0 place-items-center text-amber-500/85 [contain:layout_paint]"
              aria-label={t('session.aria.waitingForUserInput')}
              role="status"
              data-testid={`session-waiting-user-input-indicator-${session.id}`}
            >
              <UserQuestionIcon className="size-3.5" aria-hidden="true" />
            </span>
          )
        : attentionKind === 'toolApproval'
          ? (
              <span
                className="grid size-3.5 shrink-0 place-items-center text-amber-500/85 [contain:layout_paint]"
                aria-label={t('session.aria.waitingForToolApproval')}
                role="status"
                data-testid={`session-waiting-tool-approval-indicator-${session.id}`}
              >
                <SafeShieldIcon className="size-3.5" aria-hidden="true" />
              </span>
            )
          : (
              <span
                className="grid size-3.5 shrink-0 animate-spin place-items-center text-muted-foreground/70 [contain:layout_paint] [will-change:transform] motion-reduce:animate-none"
                aria-label={t('session.aria.running')}
                role="status"
                data-testid={`session-running-indicator-${session.id}`}
              >
                <LoadingLine className="size-3.5" aria-hidden="true" />
              </span>
            )
      : (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatRelativeTime(session.listActivityAt, t)}
          </span>
        )

    const prepareSessionOpen = useCallback(() => {
      onPrepareSessionOpen(session)
    }, [onPrepareSessionOpen, session])

    const prefetchSession = useCallback(() => {
      onPrefetchSession(session.id)
    }, [onPrefetchSession, session.id])

    const releaseSessionDrag = useCallback(() => {
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
      dragScreenPointerRef.current = null
      dragWasTornOffRef.current = false
    }, [])

    const recordDragPosition = useCallback((event: Event) => {
      const screenPointer = getEventScreenCoordinates(event, window)

      if (
        screenPointer
        && event.type.startsWith('drag')
        && screenPointer.screenX === 0
        && screenPointer.screenY === 0
        && dragScreenPointerRef.current
      ) {
        return
      }

      if (screenPointer) {
        dragScreenPointerRef.current = screenPointer
      }
    }, [])
    const handleOpenInNewWindow = useCallback(() => {
      if (!isElectron) {
        return
      }

      prepareSessionOpen()
      const screenX = window.screenX + Math.round(window.outerWidth / 2)
      const screenY = window.screenY + Math.round(window.outerHeight / 2)
      if (work) {
        void openTearoffSurfaceWindow({
          id: workSurfaceId(work.id),
          kind: 'work',
          title: sessionTitle,
          route: { to: '/work/$workId', params: { workId: work.id } },
          order: 0,
          closable: true,
        }, { screenX, screenY, detachSurface: true })
        return
      }
      void openTearoffChatSessionWindow(session.id, { screenX, screenY, detachSurface: true })
    }, [prepareSessionOpen, session.id, sessionTitle, work])

    function handleSessionDoubleClick(e: React.MouseEvent<HTMLButtonElement>) {
      e.preventDefault()
      e.stopPropagation()
      handleOpenInNewWindow()
    }

    const checkSessionTearOff = useCallback(() => {
      if (dragWasTornOffRef.current || !isElectron) {
        return false
      }

      const pointer = dragScreenPointerRef.current
      if (!pointer || !isPointerOutsideWindow(pointer, window)) {
        return false
      }

      dragWasTornOffRef.current = true
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
      void openTearoffChatSessionWindow(session.id, {
        screenX: pointer.screenX,
        screenY: pointer.screenY,
        detachSurface: true,
      }).then((opened) => {
        if (!opened) {
          dragWasTornOffRef.current = false
        }
      })

      return true
    }, [session.id])

    const handleDragStart = useCallback(
      (e: React.DragEvent) => {
        e.dataTransfer.setData(SESSION_DRAG_MIME_TYPE, session.id)
        e.dataTransfer.effectAllowed = 'move'
        recordDragPosition(e.nativeEvent)
        dragWasTornOffRef.current = false
        dragCleanupRef.current?.()

        const handleDragMove = (event: DragEvent | MouseEvent | PointerEvent | TouchEvent) => {
          recordDragPosition(event)
        }

        window.addEventListener('dragover', handleDragMove, true)
        window.addEventListener('mousemove', handleDragMove, true)
        window.addEventListener('pointermove', handleDragMove, true)
        window.addEventListener('touchmove', handleDragMove, true)
        dragCleanupRef.current = () => {
          window.removeEventListener('dragover', handleDragMove, true)
          window.removeEventListener('mousemove', handleDragMove, true)
          window.removeEventListener('pointermove', handleDragMove, true)
          window.removeEventListener('touchmove', handleDragMove, true)
        }
      },
      [recordDragPosition, session.id],
    )

    const handleDrag = useCallback(
      (e: React.DragEvent) => {
        recordDragPosition(e.nativeEvent)
      },
      [recordDragPosition],
    )

    const handleDragEnd = useCallback(
      (e: React.DragEvent) => {
        recordDragPosition(e.nativeEvent)
        if (!dragWasTornOffRef.current) {
          checkSessionTearOff()
        }
        releaseSessionDrag()
      },
      [checkSessionTearOff, recordDragPosition, releaseSessionDrag],
    )

    useEffect(() => {
      return releaseSessionDrag
    }, [releaseSessionDrag])

    const openSessionMenu = (anchor: SessionMenuAnchor) => {
      onOpenSessionMenu({
        sessionId: session.id,
        workId: work?.id ?? null,
        anchor,
      })
    }

    const handleOpenButtonMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      openSessionMenu(event.currentTarget)
    }

    const handleSessionContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      openSessionMenu(createPointMenuAnchor(event.clientX, event.clientY))
    }

    const handleSessionKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      openSessionMenu(createPointMenuAnchor(rect.left + 24, rect.top + rect.height / 2))
    }

    const itemContent = (
      <div
        draggable={!isRenaming && !work}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        onContextMenu={isRenaming ? undefined : handleSessionContextMenu}
        onKeyDown={isRenaming ? undefined : handleSessionKeyDown}
        onPointerEnter={isRenaming
          ? undefined
            : (event) => {
                prefetchSession()
                previewCard.show({ kind: 'session', session, anchor: event.currentTarget, placement: 'right' })
              }}
        onPointerLeave={isRenaming ? undefined : previewCard.hide}
        className={cn(
          'group relative isolate flex min-w-0 w-full items-center rounded-lg text-left text-xs hover:bg-accent/50 [content-visibility:auto] [contain-intrinsic-block-size:30px]',
          !isRenaming && !work && 'cursor-grab active:cursor-grabbing',
        )}
        data-testid={`session-item-${session.id}`}
        data-session-pinned={session.pinned ? 'true' : 'false'}
      >
        <SessionActiveBackground active={active} />
        {isRenaming
? (
          <SessionRenameInput
            key={`${session.id}:${sessionTitle}`}
            initialTitle={sessionTitle}
            sessionId={session.id}
            pinned={Boolean(session.pinned)}
            trailingLabel={formatRelativeTime(session.listActivityAt, t)}
            onCommit={nextTitle => onRenameCommit(session, nextTitle)}
            onCancel={onRenameCancel}
          />
        )
: (
          <>
            <button
              type="button"
              onClick={() => {
                previewCard.dismiss()
                prepareSessionOpen()
                if (work) {
                  openWork(work.id)
                }
                else {
                  openChatSession(session.id)
                }
              }}
              onDoubleClick={isElectron ? handleSessionDoubleClick : undefined}
              onFocus={prefetchSession}
              onPointerDown={() => {
                previewCard.dismiss()
                prepareSessionOpen()
              }}
              data-testid={`session-open-${session.id}`}
              className={cn(
                'relative z-10 flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2.5 py-1.5 text-sidebar-foreground/80',
                // System-generated sessions recede at rest; restore on any
                // engagement (hover/focus) so the row stays fully legible the
                // moment the user interacts with it.
                dimmed
                && 'opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
              )}
            >
              {work
                ? (
                    <span
                      className={cn(
                        'relative shrink-0',
                        workLeadingIconClass,
                        work.pullRequest && 'mr-1.5',
                      )}
                      title={workStateLabel ?? undefined}
                      data-testid={`work-status-${work.id}`}
                    >
                      <WorkLeadingIcon className="size-3.5" aria-hidden="true" />
                      {workActivityDotClass
                        ? (
                            <span
                              className={cn(
                                'absolute -right-0.5 -top-0.5 size-1.5 rounded-full outline outline-2 outline-background',
                                workActivityDotClass,
                              )}
                              aria-hidden="true"
                            />
                          )
                        : null}
                      {work.pullRequest
                        ? (
                            <span className="absolute -right-2 -bottom-0.5 min-w-3 rounded-full bg-gray-200 dark:bg-gray-800 px-0.5 text-center text-[7px] font-medium leading-2.5 text-muted-foreground tabular-nums">
                              #
{work.pullRequest.number}
                            </span>
                          )
                        : null}
                      {workStateLabel ? <span className="sr-only">{workStateLabel}</span> : null}
                    </span>
                  )
                : hasError
                  ? (
                <CircleAlertIcon
                  className="size-3.5 shrink-0 !text-destructive/80"
                  aria-label={t('session.aria.error')}
                  data-testid={`session-error-indicator-${session.id}`}
                />
                    )
                  : (
                <RuntimeIcon
                  icon={runtimeIcon}
                  className="size-3.5 shrink-0 text-muted-foreground/70"
                />
                    )}
              {session.pinned
? (
                <PinIcon
                  className="size-3 shrink-0 !text-primary/60"
                  aria-label={t('session.aria.pinned')}
                  data-testid={`session-pin-indicator-${session.id}`}
                />
              )
: null}
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-left',
                  isRegeneratingTitle && [
                    'text-sidebar-foreground',
                    '[mask-image:linear-gradient(90deg,rgba(0,0,0,0.35)_0%,black_36%,black_64%,rgba(0,0,0,0.35)_100%)] [mask-size:220%_100%]',
                    '[-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0.35)_0%,black_36%,black_64%,rgba(0,0,0,0.35)_100%)] [-webkit-mask-size:220%_100%]',
                    'animate-[shimmer_1.6s_linear_infinite]',
                  ],
                )}
                data-testid={`session-title-${session.id}`}
                data-regenerating={isRegeneratingTitle ? 'true' : undefined}
              >
                {sessionTitle}
              </span>
              <SessionUnreadIndicator
                show={isUnread && !isStreaming}
                active={active}
                label={t('session.aria.newReply')}
              />
              {trailingIndicator}
            </button>
            <div className="group/menu relative z-10 mr-0.5 size-6 shrink-0">
              <button
                type="button"
                className="absolute inset-0 grid place-items-center rounded-md text-muted-foreground/50 opacity-0 hover:bg-accent/80 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
                onClick={handleOpenButtonMenu}
                aria-haspopup="menu"
                aria-label={t('session.aria.menu')}
                data-testid={`session-menu-trigger-${session.id}`}
              >
                <MoreHorizontalIcon className="size-3" aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>
    )

    return itemContent
  },
)
SessionItem.displayName = 'SessionItem'

interface SessionListProps {
  sessions: WorkspaceSession[]
  workByPrimarySessionId: ReadonlyMap<string, WorkSummary>
  renamingSessionId: string | null
  locallyStreamingSessionIds: Set<string>
  sessionAttentionBySessionId: Map<string, SessionAttentionKind>
  locallyErroredSessionIds: Set<string>
  runtimeIconByKind: RuntimeIconByKind
  t: WorkspaceTranslation
  tWork: WorkTranslation
  onPrepareSessionOpen: (session: WorkspaceSession) => void
  onPrefetchSession: (sessionId: string) => void
  onRenameCommit: (session: WorkspaceSession, nextTitle: string) => Promise<void>
  onRenameCancel: () => void
  onOpenSessionMenu: (request: SessionMenuRequest) => void
}

const SessionListRows = memo(
  ({
    sessions,
    workByPrimarySessionId,
    renamingSessionId,
    locallyStreamingSessionIds,
    sessionAttentionBySessionId,
    locallyErroredSessionIds,
    runtimeIconByKind,
    t,
    tWork,
    onPrepareSessionOpen,
    onPrefetchSession,
    onRenameCommit,
    onRenameCancel,
    onOpenSessionMenu,
  }: SessionListProps) => {
    return (
      sessions.map((session) => {
        const isStreaming = isSessionRunning(session, locallyStreamingSessionIds)
        return (
          <SessionItem
            key={session.id}
            session={session}
            work={workByPrimarySessionId.get(session.id) ?? null}
            isStreaming={isStreaming}
            attentionKind={sessionAttentionBySessionId.get(session.id) ?? null}
            hasError={
              !isStreaming
              && (session.status === 'error' || locallyErroredSessionIds.has(session.id))
            }
            isRenaming={session.id === renamingSessionId}
            runtimeIcon={runtimeIconByKind.get(session.runtimeKind)}
            t={t}
            tWork={tWork}
            onPrepareSessionOpen={onPrepareSessionOpen}
            onPrefetchSession={onPrefetchSession}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            onOpenSessionMenu={onOpenSessionMenu}
          />
        )
      })
    )
  },
)
SessionListRows.displayName = 'SessionListRows'

// ── Workspace group ───────────────────────────────────────────────────────────

function WorkspaceGroupDisclosure({
  workspace,
  workspacePinned,
  workspaceActions,
  overlays,
  children,
}: {
  workspace: Workspace
  workspacePinned: boolean
  workspaceActions: WorkspaceMenuAction[]
  overlays: React.ReactNode
  children: React.ReactNode
}) {
  'use no memo'

  const { t } = useTranslation('workspace')
  const expanded = useWorkspaceSidebarUiStore(
    state => state.collapsedWorkspaceIds[workspace.id] !== true,
  )
  const setWorkspaceExpanded = useWorkspaceSidebarUiStore(state => state.setWorkspaceExpanded)
  const toggleExpanded = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setWorkspaceExpanded(workspace.id, !expanded)
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
            ? (
                <FolderOpenIcon className="size-3.5" aria-hidden="true" />
              )
            : (
                <FolderClosedIcon className="size-3.5" aria-hidden="true" />
              )
          : (
              <FolderSymlinkIcon className="size-3.5" aria-hidden="true" />
            )}
      </button>

      <button
        type="button"
        onClick={() => openWorkspaceDetail(workspace.id)}
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
              className="opacity-0 group-hover:opacity-100 -mr-1"
              onClick={e => e.stopPropagation()}
            />
          )}
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup align="start" side="bottom" sideOffset={4}>
          <WorkspaceMenuActionItems actions={workspaceActions} surface="button" />
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
          <WorkspaceMenuActionItems actions={workspaceActions} surface="context" />
        </ContextMenuContent>
      </ContextMenu>
      {overlays}
      {expanded ? children : null}
    </div>
  )
}
WorkspaceGroupDisclosure.displayName = 'WorkspaceGroupDisclosure'

function WorkspaceSessionListSection({
  workspaceId,
  sortedSessions,
  workByPrimarySessionId,
  renamingSessionId,
  retainedSessionIds,
  locallyStreamingSessionIds,
  sessionAttentionBySessionId,
  locallyErroredSessionIds,
  runtimeIconByKind,
  t,
  tWork,
  onPrepareSessionOpen,
  onPrefetchSession,
  onRenameCommit,
  onRenameCancel,
  onOpenSessionMenu,
}: {
  workspaceId: string
  sortedSessions: WorkspaceSession[]
  workByPrimarySessionId: ReadonlyMap<string, WorkSummary>
  renamingSessionId: string | null
  retainedSessionIds: Set<string>
  locallyStreamingSessionIds: Set<string>
  sessionAttentionBySessionId: Map<string, SessionAttentionKind>
  locallyErroredSessionIds: Set<string>
  runtimeIconByKind: RuntimeIconByKind
  t: WorkspaceTranslation
  tWork: WorkTranslation
  onPrepareSessionOpen: (session: WorkspaceSession) => void
  onPrefetchSession: (sessionId: string) => void
  onRenameCommit: (session: WorkspaceSession, nextTitle: string) => Promise<void>
  onRenameCancel: () => void
  onOpenSessionMenu: (request: SessionMenuRequest) => void
}) {
  'use no memo'

  const sessionListExpanded = useWorkspaceSidebarUiStore(
    state => state.expandedSessionListWorkspaceIds[workspaceId] === true,
  )
  const setWorkspaceSessionListExpanded = useWorkspaceSidebarUiStore(
    state => state.setWorkspaceSessionListExpanded,
  )
  const sessionPreviewLimit = useWorkspaceSidebarUiStore(
    state => state.sessionPreviewLimit,
  )
  const [expandedSessionRenderCount, setExpandedSessionRenderCount]
    = useState(sessionPreviewLimit)
  const requiredPreviewCount = useMemo(() => {
    let highestRequiredIndex = -1
    for (const [index, session] of sortedSessions.entries()) {
      if (
        session.pinned
        || isSessionRunning(session, locallyStreamingSessionIds)
        || retainedSessionIds.has(session.id)
      ) {
        highestRequiredIndex = index
      }
    }
    return highestRequiredIndex + 1
  }, [locallyStreamingSessionIds, retainedSessionIds, sortedSessions])
  const collapsedSessionPreviewLimit = Math.max(sessionPreviewLimit, requiredPreviewCount)
  const hasHiddenSessions = sortedSessions.length > collapsedSessionPreviewLimit
  const hiddenSessionCount = Math.max(sortedSessions.length - collapsedSessionPreviewLimit, 0)
  const renderedSessionCount = sessionListExpanded
    ? Math.min(
        Math.max(expandedSessionRenderCount, collapsedSessionPreviewLimit),
        sortedSessions.length,
      )
    : collapsedSessionPreviewLimit
  const visibleSessions = useMemo(
    () => sortedSessions.slice(0, renderedSessionCount),
    [renderedSessionCount, sortedSessions],
  )

  useEffect(() => {
    if (!sessionListExpanded) {
      setExpandedSessionRenderCount(current =>
        current === collapsedSessionPreviewLimit ? current : collapsedSessionPreviewLimit)
      return
    }

    if (expandedSessionRenderCount >= sortedSessions.length) {
      return
    }

    const timeout = window.setTimeout(() => {
      startTransition(() => {
        setExpandedSessionRenderCount(current =>
          Math.min(
            Math.max(current, collapsedSessionPreviewLimit) + SESSION_REVEAL_BATCH_SIZE,
            sortedSessions.length,
          ))
      })
    }, SESSION_REVEAL_DELAY_MS)

    return () => window.clearTimeout(timeout)
  }, [
    collapsedSessionPreviewLimit,
    expandedSessionRenderCount,
    sessionListExpanded,
    sortedSessions.length,
  ])

  const toggleSessionListExpanded = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setWorkspaceSessionListExpanded(workspaceId, !sessionListExpanded)
    },
    [sessionListExpanded, setWorkspaceSessionListExpanded, workspaceId],
  )

  return (
    <div className="min-w-0 overflow-hidden">
      <div className="ml-4.25 flex min-w-0 flex-col gap-0.5 border-l border-sidebar-border/50 pl-2 py-0.5">
        {sortedSessions.length === 0 && (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t('session.empty')}</p>
        )}
        <SessionListRows
          sessions={visibleSessions}
          workByPrimarySessionId={workByPrimarySessionId}
          renamingSessionId={renamingSessionId}
          locallyStreamingSessionIds={locallyStreamingSessionIds}
          sessionAttentionBySessionId={sessionAttentionBySessionId}
          locallyErroredSessionIds={locallyErroredSessionIds}
          runtimeIconByKind={runtimeIconByKind}
          t={t}
          tWork={tWork}
          onPrepareSessionOpen={onPrepareSessionOpen}
          onPrefetchSession={onPrefetchSession}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          onOpenSessionMenu={onOpenSessionMenu}
        />
        {hasHiddenSessions && (
          <button
            type="button"
            onClick={toggleSessionListExpanded}
            className="mt-0.5 flex h-6 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-left text-[11px] text-muted-foreground hover:bg-accent/50 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-expanded={sessionListExpanded}
            data-testid={`workspace-sessions-toggle-${workspaceId}`}
          >
            {sessionListExpanded
? (
              <ChevronUpIcon className="size-3 shrink-0" aria-hidden="true" />
            )
: (
              <ChevronDownIcon className="size-3 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate">
              {sessionListExpanded
                ? t('session.action.showLess')
                : t('session.action.showAll', { count: hiddenSessionCount })}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
WorkspaceSessionListSection.displayName = 'WorkspaceSessionListSection'

const WorkspaceGroup = memo(
  ({
    workspace,
    sessions,
    projectFilter,
    runtimeIconByKind,
    onDelete,
    onTogglePin,
  }: {
    workspace: Workspace
    sessions: WorkspaceSession[]
    projectFilter: WorkspaceSidebarProjectFilter
    runtimeIconByKind: RuntimeIconByKind
    onDelete: (id: string) => void
    onTogglePin: (id: string, pinned: boolean) => void
  }) => {
    const { t } = useTranslation('workspace')
    const { t: tWork } = useTranslation('work')
    const queryClient = useQueryClient()
    const { selectDirectory } = useDirectoryPicker()
    const [renameOpen, setRenameOpen] = useState(false)
    const [migrateOpen, setMigrateOpen] = useState(false)
    const [retainedSessionIds, setRetainedSessionIds] = useState<Set<string>>(() => new Set())
    const acknowledgedSessionIdsRef = useRef<Set<string> | null>(null)
    if (acknowledgedSessionIdsRef.current === null) {
      acknowledgedSessionIdsRef.current = new Set()
    }
    const [createRequest, setCreateRequest] = useState<{
      kind: 'file' | 'folder'
    } | null>(null)
    const [sessionMenuState, setSessionMenuState]
      = useState<SessionMenuState>(CLOSED_SESSION_MENU_STATE)
    const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
    const workspacePinned = Boolean(workspace.pinned)
    const workspaceSessionIds = useMemo(() => sessions.map(session => session.id), [sessions])
    const sessionsById = useMemo(() => {
      const byId = new Map<string, WorkspaceSession>()
      for (const session of sessions) {
        byId.set(session.id, session)
      }
      return byId
    }, [sessions])
    const activeMenuSession = sessionMenuState.sessionId
      ? (sessionsById.get(sessionMenuState.sessionId) ?? null)
      : null
    const locallyStreamingSessionIds = useChatStore(
      useCallback(
        state =>
          new Set(
            workspaceSessionIds.filter(sessionId =>
              chatSelectors.isSessionStreaming(sessionId)(state)),
          ),
        [workspaceSessionIds],
      ),
      shallow,
    )
    const sessionAttentionBySessionId = useSessionAttentionBySessionId(
      sessions,
      locallyStreamingSessionIds,
    )
    const locallyErroredSessionIds = useChatStore(
      useCallback(
        (state) => {
          if (state.errorMap.size === 0) {
            return EMPTY_SESSION_ID_SET
          }
          return new Set(
            workspaceSessionIds.filter(sessionId =>
              Boolean(chatSelectors.latestError(sessionId)(state))),
          )
        },
        [workspaceSessionIds],
      ),
      shallow,
    )
    const now = useNow()
    const currentUnixTimestamp = Math.floor(now / 1000)
    const filteredSessions = useMemo(() => {
      return sessions.filter(session =>
        sessionMatchesProjectFilter(
          session,
          projectFilter,
          locallyStreamingSessionIds,
          currentUnixTimestamp,
        ))
    }, [currentUnixTimestamp, locallyStreamingSessionIds, projectFilter, sessions])
    const { mutateAsync: renameWorkspace } = useMutation({
      ...patchWorkspacesByWorkspaceIdMutation(),
      onSuccess: () => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: ['workspace', workspace.id] }),
        ])
      },
    })
    const { mutateAsync: relinkWorkspace } = useMutation({
      ...patchWorkspacesByWorkspaceIdLocationMutation(),
      onSuccess: () => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: ['workspace', workspace.id] }),
        ])
      },
    })
    const { mutateAsync: createWorkspaceFile } = useMutation(postWorkspacesByWorkspaceIdFilesFileMutation())
    const { mutateAsync: createWorkspaceFolder } = useMutation(
      postWorkspacesByWorkspaceIdFilesFolderMutation(),
    )
    const sortedSessions = useMemo(() => {
      return filteredSessions.toSorted((a, b) => {
        const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        if (pinDiff !== 0) {
          return pinDiff
        }
        const runningDiff
          = (isSessionRunning(b, locallyStreamingSessionIds) ? 1 : 0)
            - (isSessionRunning(a, locallyStreamingSessionIds) ? 1 : 0)
        if (runningDiff !== 0) {
          return runningDiff
        }
        return 0
      })
    }, [filteredSessions, locallyStreamingSessionIds])
    const { data: workspaceWorks = [] } = useWorkspaceWorks(workspace.id)
    const activeMenuWork = sessionMenuState.workId
      ? (workspaceWorks.find(work => work.id === sessionMenuState.workId) ?? null)
      : null
    const workByPrimarySessionId = useMemo(
      () => new Map(workspaceWorks.map(work => [work.primarySessionId, work])),
      [workspaceWorks],
    )
    const sidebarSessions = useMemo(
      () => sortedSessions.filter(session =>
        session.origin !== 'work' || workByPrimarySessionId.has(session.id)),
      [sortedSessions, workByPrimarySessionId],
    )
    const { data: sessionGroups = [] } = useSessionGroups(workspace.id)
    const createSessionGroup = useCreateSessionGroup(workspace.id)
    const updateSessionGroup = useUpdateSessionGroup(workspace.id)
    const deleteSessionGroup = useDeleteSessionGroup(workspace.id)
    const addSessionGroupMembers = useAddSessionGroupMembers(workspace.id)
    const removeSessionGroupMember = useRemoveSessionGroupMember(workspace.id)
    const [createGroupOpen, setCreateGroupOpen] = useState(false)
    const [createGroupSeedSession, setCreateGroupSeedSession] = useState<WorkspaceSession | null>(null)
    const [renameGroupTarget, setRenameGroupTarget] = useState<WorkspaceSessionGroup | null>(null)
    const { grouped: groupedSessions, ungrouped: ungroupedSessions } = useMemo(
      () => partitionWorkspaceSessions(sidebarSessions, sessionGroups),
      [sessionGroups, sidebarSessions],
    )
    const sortSessionsForList = useCallback((items: WorkspaceSession[]) => {
      return items.toSorted((a, b) => {
        const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        if (pinDiff !== 0) {
          return pinDiff
        }
        const runningDiff
          = (isSessionRunning(b, locallyStreamingSessionIds) ? 1 : 0)
            - (isSessionRunning(a, locallyStreamingSessionIds) ? 1 : 0)
        if (runningDiff !== 0) {
          return runningDiff
        }
        return 0
      })
    }, [locallyStreamingSessionIds])
    const handleCreateSessionGroup = useCallback(async (titleRaw: string) => {
      const title = titleRaw.trim()
      if (!title) {
        return
      }
      try {
        await createSessionGroup.mutateAsync({
          body: {
            workspaceId: workspace.id,
            title,
            ...(createGroupSeedSession ? { sessionIds: [createGroupSeedSession.id] } : {}),
          },
        })
        setCreateGroupOpen(false)
        setCreateGroupSeedSession(null)
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: t('sessionGroup.toast.createFailed'),
          description: formatToastError(error),
        })
      }
    }, [createGroupSeedSession, createSessionGroup, t, workspace.id])
    const handleRenameSessionGroup = useCallback(async (titleRaw: string) => {
      if (!renameGroupTarget) {
        return
      }
      const title = titleRaw.trim()
      if (!title || title === renameGroupTarget.title) {
        setRenameGroupTarget(null)
        return
      }
      try {
        await updateSessionGroup.mutateAsync({
          path: { id: renameGroupTarget.id },
          body: { title },
        })
        setRenameGroupTarget(null)
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: t('sessionGroup.toast.renameFailed'),
          description: formatToastError(error),
        })
      }
    }, [renameGroupTarget, t, updateSessionGroup])
    const handleDeleteSessionGroup = useCallback(async (group: WorkspaceSessionGroup) => {
      try {
        await deleteSessionGroup.mutateAsync({ path: { id: group.id } })
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: t('sessionGroup.toast.deleteFailed'),
          description: formatToastError(error),
        })
      }
    }, [deleteSessionGroup, t])
    const handleAddSessionToGroup = useCallback(async (sessionId: string, groupId: string) => {
      try {
        await addSessionGroupMembers.mutateAsync({
          path: { id: groupId },
          body: { sessionIds: [sessionId] },
        })
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: t('sessionGroup.toast.addMemberFailed'),
          description: formatToastError(error),
        })
      }
    }, [addSessionGroupMembers, t])
    const handleRemoveSessionFromGroup = useCallback(async (session: WorkspaceSession) => {
      if (!session.sessionGroupId) {
        return
      }
      try {
        await removeSessionGroupMember.mutateAsync({
          groupId: session.sessionGroupId,
          sessionId: session.id,
        })
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: t('sessionGroup.toast.removeMemberFailed'),
          description: formatToastError(error),
        })
      }
    }, [removeSessionGroupMember, t])
    const handleCreateSessionGroupFromSession = useCallback((session: WorkspaceSession) => {
      setCreateGroupSeedSession(session)
      setCreateGroupOpen(true)
    }, [])
    const workspaceLocalPath = getLocalWorkspacePath(workspace)
    const workspaceLocationLabel = getWorkspaceLocationLabel(workspace)

    useEffect(() => {
      setRetainedSessionIds((current) => {
        let changed = false
        const next = new Set<string>()
        const knownSessionIds = new Set(workspaceSessionIds)

        for (const sessionId of current) {
          if (knownSessionIds.has(sessionId)) {
            next.add(sessionId)
          }
 else {
            changed = true
          }
        }

        for (const session of sessions) {
          if (
            isSessionRunning(session, locallyStreamingSessionIds)
            && !acknowledgedSessionIdsRef.current!.has(session.id)
            && !next.has(session.id)
          ) {
            next.add(session.id)
            changed = true
          }
        }

        return changed ? next : current
      })
    }, [locallyStreamingSessionIds, sessions, workspaceSessionIds])

    const handleOpenSession = useCallback((sessionId: string) => {
      acknowledgedSessionIdsRef.current!.add(sessionId)
      setRetainedSessionIds((current) => {
        if (!current.has(sessionId)) {
          return current
        }
        const next = new Set(current)
        next.delete(sessionId)
        return next
      })
    }, [])
    const prefetchSession = useCallback(
      (sessionId: string) => {
        prefetchChatSession(queryClient, sessionId)
      },
      [queryClient],
    )
    const handlePrepareSessionOpen = useCallback(
      (session: WorkspaceSession) => {
        handleOpenSession(session.id)
        prefetchSession(session.id)
      },
      [handleOpenSession, prefetchSession],
    )
    const handleRenameSession = useCallback(
      async (session: WorkspaceSession, nextTitleRaw: string) => {
        const nextTitle = nextTitleRaw.trim()
        setRenamingSessionId(null)

        if (!nextTitle || nextTitle === (session.title ?? t('session.fallbackTitle'))) {
          return
        }

        await patchSessionsById({ path: { id: session.id }, body: { title: nextTitle } })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspace.id) }),
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
          queryClient.invalidateQueries({
            queryKey: getSessionsByIdQueryKey({ path: { id: session.id } }),
          }),
        ])
      },
      [queryClient, t, workspace.id],
    )
    const handleRenameCancel = useCallback(() => {
      setRenamingSessionId(null)
    }, [])
    const handleStartSessionRename = useCallback((sessionId: string) => {
      setRenamingSessionId(sessionId)
    }, [])
    const handleOpenSessionMenu = useCallback((request: SessionMenuRequest) => {
      setSessionMenuState({
        ...request,
        open: true,
      })
    }, [])
    const handleSessionMenuOpenChange = useCallback((open: boolean) => {
      setSessionMenuState(current =>
        open && current.anchor ? { ...current, open: true } : CLOSED_SESSION_MENU_STATE)
    }, [])

    useEffect(() => {
      const next = new Set<string>()

      for (const sessionId of acknowledgedSessionIdsRef.current!) {
        const session = sessionsById.get(sessionId)
        if (session && isSessionRunning(session, locallyStreamingSessionIds)) {
          next.add(sessionId)
        }
      }

      acknowledgedSessionIdsRef.current! = next
    }, [locallyStreamingSessionIds, sessionsById])
    const handleTogglePin = useCallback(() => {
      onTogglePin(workspace.id, !workspacePinned)
    }, [onTogglePin, workspace.id, workspacePinned])
    const handleOpenWorkspace = useCallback(() => {
      openWorkspaceDetail(workspace.id)
    }, [workspace.id])
    const handleRelinkWorkspace = useCallback(async () => {
      const path = await selectDirectory({
        title: t('workspace.dialog.relinkTitle'),
        description: t('workspace.dialog.relinkDescription', { name: workspace.name }),
      })
      if (!path) {
        return
      }
      try {
        await relinkWorkspace({
          path: { workspaceId: workspace.id },
          body: { path },
        })
      }
      catch (error) {
        toastManager.add({
          type: 'error',
          title: t('workspace.toast.relinkFailed'),
          description: formatToastError(error),
        })
      }
    }, [relinkWorkspace, selectDirectory, t, workspace.id, workspace.name])
    const handleOpenDefault = useCallback(async () => {
      if (!isElectron || !nativeIpc) {
        return
      }
      if (!workspaceLocalPath) {
        return
      }

      try {
        await nativeIpc.native.openPath(workspaceLocalPath)
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: t('workspace.toast.openDefaultFailed'),
          description: formatToastError(error),
        })
      }
    }, [t, workspaceLocalPath])
    const handleRevealInFinder = useCallback(async () => {
      if (!isElectron || !nativeIpc) {
        return
      }
      if (!workspaceLocalPath) {
        return
      }

      try {
        await nativeIpc.native.showItemInFolder(workspaceLocalPath)
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: t('workspace.toast.openInFinderFailed'),
          description: formatToastError(error),
        })
      }
    }, [t, workspaceLocalPath])
    const handleCopyAbsolutePath = useCallback(async () => {
      await navigator.clipboard.writeText(workspaceLocationLabel)
    }, [workspaceLocationLabel])
    const handleRenameWorkspace = useCallback(
      async (value: string) => {
        const name = value.trim()
        if (!name || name === workspace.name) {
          setRenameOpen(false)
          return
        }

        try {
          await renameWorkspace({ path: { workspaceId: workspace.id }, body: { name } })
          setRenameOpen(false)
        }
 catch (error) {
          toastManager.add({
            type: 'error',
            title: t('workspace.toast.renameFailed'),
            description: formatToastError(error),
          })
        }
      },
      [renameWorkspace, t, workspace.id, workspace.name],
    )
    const handleCreateWorkspaceChild = useCallback(
      async (nameValue: string) => {
        if (!createRequest) {
          return
        }

        const name = nameValue.trim()
        if (!name) {
          return
        }

        const request = {
          path: { workspaceId: workspace.id },
          body: {
            path: name,
            confirmedNonCradleOwnedWrite: true,
          },
        }
        try {
          const data
            = createRequest.kind === 'file'
              ? await createWorkspaceFile(request)
              : await createWorkspaceFolder(request)

          if (!data.success) {
            toastManager.add({
              type: 'error',
              title: t('workspace.toast.createFailed'),
            })
            return
          }

          await queryClient.invalidateQueries({ queryKey: ['workspace-file-search', workspace.id] })
          setCreateRequest(null)
        }
 catch (error) {
          toastManager.add({
            type: 'error',
            title: t('workspace.toast.createFailed'),
            description: formatToastError(error),
          })
        }
      },
      [createRequest, createWorkspaceFile, createWorkspaceFolder, queryClient, t, workspace.id],
    )
    const handleOpenCreateDialogChange = useCallback((open: boolean) => {
      if (!open) {
        setCreateRequest(null)
      }
    }, [])
    const workspaceActions = useMemo<WorkspaceMenuAction[]>(
      () => [
        {
          key: 'open',
          label: t('workspace.action.open'),
          icon: <ExternalLinkIcon />,
          testId: `workspace-open-action-${workspace.id}`,
          invoke: handleOpenWorkspace,
        },
        ...(workspace.availability === 'missing'
          ? [{
              key: 'relink',
              label: t('workspace.action.relink'),
              icon: <RefreshCwIcon />,
              testId: `workspace-relink-${workspace.id}`,
              invoke: handleRelinkWorkspace,
            }] satisfies WorkspaceMenuAction[]
          : []),
        ...(workspaceLocalPath
          ? [
              {
                key: 'open-default',
                label: t('workspace.action.openDefault'),
                icon: <ExternalLinkIcon />,
                testId: `workspace-open-default-${workspace.id}`,
                invoke: handleOpenDefault,
              },
              {
                key: 'open-in-finder',
                label: t('workspace.action.openInFinder'),
                icon: <FolderOpenIcon />,
                testId: `workspace-open-in-finder-${workspace.id}`,
                invoke: handleRevealInFinder,
              },
              {
                key: 'new-file',
                label: t('workspace.action.newFile'),
                icon: <FilePlusIcon />,
                testId: `workspace-new-file-${workspace.id}`,
                invoke: () => setCreateRequest({ kind: 'file' }),
                separatorBefore: true,
              },
              {
                key: 'new-folder',
                label: t('workspace.action.newFolder'),
                icon: <FolderPlusIcon />,
                testId: `workspace-new-folder-${workspace.id}`,
                invoke: () => setCreateRequest({ kind: 'folder' }),
              },
            ] satisfies WorkspaceMenuAction[]
          : []),
        {
          key: 'rename',
          label: t('workspace.action.rename'),
          icon: <PencilIcon />,
          testId: `workspace-rename-${workspace.id}`,
          invoke: () => setRenameOpen(true),
        },
        {
          key: 'copy-path',
          label: t('workspace.action.copyPath'),
          icon: <CopyIcon />,
          testId: `workspace-copy-path-${workspace.id}`,
          invoke: handleCopyAbsolutePath,
          separatorBefore: true,
        },
        {
          key: 'copy-relative-path',
          label: t('workspace.action.copyRelativePath'),
          icon: <ClipboardCopyIcon />,
          testId: `workspace-copy-relative-path-${workspace.id}`,
          invoke: async () => navigator.clipboard.writeText('.'),
        },
        {
          key: 'new-session-group',
          label: t('sessionGroup.action.create'),
          icon: <FolderPlusIcon />,
          testId: `workspace-new-session-group-${workspace.id}`,
          invoke: () => {
            setCreateGroupSeedSession(null)
            setCreateGroupOpen(true)
          },
          separatorBefore: true,
        },
        {
          key: 'toggle-pin',
          label: workspacePinned ? t('workspace.action.unpin') : t('workspace.action.pin'),
          icon: workspacePinned ? <PinOffIcon /> : <PinIcon />,
          testId: `workspace-toggle-pin-${workspace.id}`,
          invoke: handleTogglePin,
          separatorBefore: true,
        },
        {
          key: 'migrate',
          label: t('workspace.action.migrate'),
          icon: <ArrowUpDownIcon />,
          testId: `workspace-migrate-${workspace.id}`,
          invoke: () => setMigrateOpen(true),
          separatorBefore: true,
        },
        {
          key: 'remove',
          label: t('workspace.action.remove'),
          icon: <Trash2Icon />,
          testId: `workspace-remove-${workspace.id}`,
          invoke: () => onDelete(workspace.id),
          variant: 'destructive',
          separatorBefore: true,
        },
      ],
      [
        handleCopyAbsolutePath,
        handleOpenDefault,
        handleOpenWorkspace,
        handleRelinkWorkspace,
        handleRevealInFinder,
        handleTogglePin,
        onDelete,
        t,
        workspace.id,
        workspace.availability,
        workspaceLocalPath,
        workspacePinned,
      ],
    )

    return (
      <WorkspaceGroupDisclosure
        workspace={workspace}
        workspacePinned={workspacePinned}
        workspaceActions={workspaceActions}
        overlays={(
          <>
            <WorkspaceTextInputDialog
              open={renameOpen}
              title={t('workspace.dialog.renameTitle')}
              initialValue={workspace.name}
              label={t('workspace.dialog.nameLabel')}
              confirmLabel={t('workspace.dialog.rename')}
              onOpenChange={setRenameOpen}
              onCommit={handleRenameWorkspace}
            />
            <MigrateWorkspaceDialog
              open={migrateOpen}
              onOpenChange={setMigrateOpen}
              sourceWorkspaceId={workspace.id}
            />
            <WorkspaceTextInputDialog
              open={createRequest !== null}
              title={
                createRequest?.kind === 'folder'
                  ? t('workspace.dialog.newFolderTitle')
                  : t('workspace.dialog.newFileTitle')
              }
              initialValue={
                createRequest?.kind === 'folder'
                  ? DEFAULT_WORKSPACE_FOLDER_NAME
                  : DEFAULT_WORKSPACE_FILE_NAME
              }
              label={t('workspace.dialog.nameLabel')}
              confirmLabel={t('workspace.dialog.create')}
              onOpenChange={handleOpenCreateDialogChange}
              onCommit={handleCreateWorkspaceChild}
            />
            <WorkspaceTextInputDialog
              open={createGroupOpen}
              title={t('sessionGroup.dialog.createTitle')}
              initialValue=""
              label={t('sessionGroup.dialog.titleLabel')}
              confirmLabel={t('sessionGroup.dialog.create')}
              onOpenChange={(open) => {
                setCreateGroupOpen(open)
                if (!open) {
                  setCreateGroupSeedSession(null)
                }
              }}
              onCommit={handleCreateSessionGroup}
            />
            <WorkspaceTextInputDialog
              open={renameGroupTarget !== null}
              title={t('sessionGroup.dialog.renameTitle')}
              initialValue={renameGroupTarget?.title ?? ''}
              label={t('sessionGroup.dialog.titleLabel')}
              confirmLabel={t('sessionGroup.dialog.rename')}
              onOpenChange={(open) => {
                if (!open) {
                  setRenameGroupTarget(null)
                }
              }}
              onCommit={handleRenameSessionGroup}
            />
            <SessionActionsMenu
              state={sessionMenuState}
              session={activeMenuSession}
              work={activeMenuWork}
              workspaceId={workspace.id}
              sessionGroups={sessionGroups}
              onOpenChange={handleSessionMenuOpenChange}
              onPrepareSessionOpen={handlePrepareSessionOpen}
              onStartRename={handleStartSessionRename}
              onAddSessionToGroup={handleAddSessionToGroup}
              onRemoveSessionFromGroup={handleRemoveSessionFromGroup}
              onCreateSessionGroupFromSession={handleCreateSessionGroupFromSession}
            />
          </>
        )}
      >
        <div className="flex min-w-0 flex-col">
          {groupedSessions.map(({ group, sessions: groupSessions }) => (
            <WorkspaceSessionGroupSection
              key={group.id}
              group={group}
              sessions={groupSessions}
              workspaceId={workspace.id}
              t={t}
              onRenameGroup={setRenameGroupTarget}
              onDeleteGroup={handleDeleteSessionGroup}
            >
              <WorkspaceSessionListSection
                workspaceId={workspace.id}
                sortedSessions={sortSessionsForList(groupSessions)}
                workByPrimarySessionId={workByPrimarySessionId}
                renamingSessionId={renamingSessionId}
                retainedSessionIds={retainedSessionIds}
                locallyStreamingSessionIds={locallyStreamingSessionIds}
                sessionAttentionBySessionId={sessionAttentionBySessionId}
                locallyErroredSessionIds={locallyErroredSessionIds}
                runtimeIconByKind={runtimeIconByKind}
                t={t}
                tWork={tWork}
                onPrepareSessionOpen={handlePrepareSessionOpen}
                onPrefetchSession={prefetchSession}
                onRenameCommit={handleRenameSession}
                onRenameCancel={handleRenameCancel}
                onOpenSessionMenu={handleOpenSessionMenu}
              />
            </WorkspaceSessionGroupSection>
          ))}
          {(ungroupedSessions.length > 0 || groupedSessions.length === 0) && (
            <WorkspaceSessionListSection
              workspaceId={workspace.id}
              sortedSessions={sortSessionsForList(ungroupedSessions)}
              workByPrimarySessionId={workByPrimarySessionId}
              renamingSessionId={renamingSessionId}
              retainedSessionIds={retainedSessionIds}
              locallyStreamingSessionIds={locallyStreamingSessionIds}
              sessionAttentionBySessionId={sessionAttentionBySessionId}
              locallyErroredSessionIds={locallyErroredSessionIds}
              runtimeIconByKind={runtimeIconByKind}
              t={t}
              tWork={tWork}
              onPrepareSessionOpen={handlePrepareSessionOpen}
              onPrefetchSession={prefetchSession}
              onRenameCommit={handleRenameSession}
              onRenameCancel={handleRenameCancel}
              onOpenSessionMenu={handleOpenSessionMenu}
            />
          )}
        </div>
      </WorkspaceGroupDisclosure>
    )
  },
)
WorkspaceGroup.displayName = 'WorkspaceGroup'

// ── Top nav items ─────────────────────────────────────────────────────────────

interface NavItemProps {
  active?: boolean
  icon: React.ReactNode
  label: string
  shortcut?: string
  collapsed?: boolean
  onClick?: () => void
  dataTestId?: string
}

function TopNavItem({
  active = false,
  icon,
  label,
  shortcut,
  collapsed,
  onClick,
  dataTestId,
}: NavItemProps) {
  const className = cn(
    'group flex h-7 w-full items-center gap-2 overflow-hidden rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground/80 hover:bg-accent/50 hover:text-sidebar-foreground',
    active && 'bg-accent/70 text-sidebar-foreground',
  )
  const iconNode = (
    <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70">
      {icon}
    </span>
  )

  const content = (
    <>
      {collapsed
? (
        <Tooltip>
          <TooltipTrigger asChild>{iconNode}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {label}
          </TooltipContent>
        </Tooltip>
      )
: (
        iconNode
      )}
      <span
        className={cn(
          'flex-1 overflow-hidden text-left whitespace-nowrap',
          collapsed ? 'opacity-0' : 'opacity-100',
        )}
      >
        {label}
      </span>
      {shortcut && (
        <span
          className={cn(
            'shrink-0 overflow-hidden font-mono text-[10px] text-muted-foreground/40 whitespace-nowrap',
            collapsed ? 'opacity-0' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {shortcut}
        </span>
      )}
    </>
  )

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      className={className}
      aria-current={active ? 'page' : undefined}
    >
      {content}
    </button>
  )
}

function workspaceHasUnreadSession(sessions: readonly WorkspaceSession[]): boolean {
  return sessions.some(session => session.unread)
}

function workspaceHasRunningSession(
  sessions: readonly WorkspaceSession[],
  locallyStreamingSessionIds: Set<string>,
): boolean {
  return sessions.some(session => isSessionRunning(session, locallyStreamingSessionIds))
}

function workspaceHasRecentSession(
  sessions: readonly WorkspaceSession[],
  currentUnixTimestamp: number,
): boolean {
  return sessions.some(session => isSessionRecent(session, currentUnixTimestamp))
}

function sessionMatchesProjectFilter(
  session: WorkspaceSession,
  filter: WorkspaceSidebarProjectFilter,
  locallyStreamingSessionIds: Set<string>,
  currentUnixTimestamp: number,
): boolean {
  switch (filter) {
    case 'unread':
      return session.unread
    case 'running':
      return isSessionRunning(session, locallyStreamingSessionIds)
    case 'recent':
      return isSessionRecent(session, currentUnixTimestamp)
    case 'pinned':
    case 'unpinned':
    case 'all':
      return true
  }
}

function projectMatchesFilter(
  workspace: Workspace,
  sessions: readonly WorkspaceSession[],
  filter: WorkspaceSidebarProjectFilter,
  locallyStreamingSessionIds: Set<string>,
  currentUnixTimestamp: number,
): boolean {
  switch (filter) {
    case 'pinned':
      return Boolean(workspace.pinned)
    case 'unpinned':
      return !workspace.pinned
    case 'unread':
      return workspaceHasUnreadSession(sessions)
    case 'running':
      return workspaceHasRunningSession(sessions, locallyStreamingSessionIds)
    case 'recent':
      return workspaceHasRecentSession(sessions, currentUnixTimestamp)
    case 'all':
      return true
  }
}

function compareProjectBySortKey(
  left: Workspace,
  right: Workspace,
  sortKey: WorkspaceSidebarProjectSortKey,
): number {
  switch (sortKey) {
    case 'createdAt':
      return left.createdAt - right.createdAt
    case 'updatedAt':
      return left.updatedAt - right.updatedAt
    case 'name':
      return left.name.localeCompare(right.name)
  }
}

// ── Main sidebar content ──────────────────────────────────────────────────────

interface WorkspaceSidebarBodyProps {
  workspaces: Workspace[]
  workspacesReady: boolean
  sessionsByWorkspaceId: Map<string, WorkspaceSession[]>
  runtimeIconByKind: RuntimeIconByKind
  adding: boolean
  multiWorkspaceEnabled: boolean
  onAddFromPicker: () => void
  onOpenMultiWorkspaceDialog: () => void
  hasUnreadWorkspaceSessions: boolean
  markingAllSessionsRead: boolean
  onMarkAllAsRead: () => void
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
}

const WorkspaceSidebarBody = memo(
  ({
    workspaces,
    workspacesReady,
    sessionsByWorkspaceId,
    runtimeIconByKind,
    adding,
    multiWorkspaceEnabled,
    onAddFromPicker,
    onOpenMultiWorkspaceDialog,
    hasUnreadWorkspaceSessions,
    markingAllSessionsRead,
    onMarkAllAsRead,
    onDelete,
    onTogglePin,
  }: WorkspaceSidebarBodyProps) => {
    const { t } = useTranslation('workspace')
    const pruneWorkspaceSidebarState = useWorkspaceSidebarUiStore(
      state => state.pruneWorkspaceSidebarState,
    )
    const projectFilter = useWorkspaceSidebarUiStore(state => state.projectFilter)
    const projectSortKey = useWorkspaceSidebarUiStore(state => state.projectSortKey)
    const projectSortDirection = useWorkspaceSidebarUiStore(state => state.projectSortDirection)
    const projectPinnedFirst = useWorkspaceSidebarUiStore(state => state.projectPinnedFirst)
    const setProjectFilter = useWorkspaceSidebarUiStore(state => state.setProjectFilter)
    const setProjectSortKey = useWorkspaceSidebarUiStore(state => state.setProjectSortKey)
    const setProjectSortDirection = useWorkspaceSidebarUiStore(
      state => state.setProjectSortDirection,
    )
    const setProjectPinnedFirst = useWorkspaceSidebarUiStore(state => state.setProjectPinnedFirst)
    const workspaceIds = useMemo(() => workspaces.map(workspace => workspace.id), [workspaces])
    const sessionIds = useMemo(() => {
      const ids: string[] = []
      for (const sessions of sessionsByWorkspaceId.values()) {
        for (const session of sessions) {
          ids.push(session.id)
        }
      }
      return ids
    }, [sessionsByWorkspaceId])
    const locallyStreamingSessionIds = useChatStore(
      useCallback(
        state =>
          new Set(
            sessionIds.filter(sessionId => chatSelectors.isSessionStreaming(sessionId)(state)),
          ),
        [sessionIds],
      ),
      shallow,
    )
    const now = useNow()
    const currentUnixTimestamp = Math.floor(now / 1000)
    const visibleWorkspaces = useMemo(() => {
      return workspaces
        .filter(workspace =>
          projectMatchesFilter(
            workspace,
            sessionsByWorkspaceId.get(workspace.id) ?? [],
            projectFilter,
            locallyStreamingSessionIds,
            currentUnixTimestamp,
          ))
        .toSorted((left, right) => {
          if (projectPinnedFirst) {
            const pinDiff = (right.pinned ? 1 : 0) - (left.pinned ? 1 : 0)
            if (pinDiff !== 0) {
              return pinDiff
            }
          }

          const keyDiff = compareProjectBySortKey(left, right, projectSortKey)
          const directedKeyDiff = projectSortDirection === 'desc' ? -keyDiff : keyDiff
          if (directedKeyDiff !== 0) {
            return directedKeyDiff
          }

          return left.name.localeCompare(right.name)
        })
    }, [
      currentUnixTimestamp,
      locallyStreamingSessionIds,
      projectFilter,
      projectPinnedFirst,
      projectSortDirection,
      projectSortKey,
      sessionsByWorkspaceId,
      workspaces,
    ])
    const hasFilteredWorkspaces = workspaces.length > 0 && visibleWorkspaces.length === 0

    useEffect(() => {
      if (!workspacesReady) {
        return
      }
      pruneWorkspaceSidebarState(workspaceIds)
    }, [pruneWorkspaceSidebarState, workspaceIds, workspacesReady])

    return (
      <PreviewCardProvider>
        {/* ── Kanban section ── */}
        <KanbanSidebar collapsed={false} />

        {/* ── Plugins section ── */}
        <PluginsSidebar collapsed={false} />

        {/* ── Projects section ── */}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center px-2.5 py-1.5">
            <span className="flex-1 text-[11px] font-medium text-muted-foreground select-none">
              {t('sidebar.projects.title')}
            </span>
            <div className="flex items-center gap-0.5">
              {hasUnreadWorkspaceSessions && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 text-muted-foreground/60 hover:bg-fill/70 hover:text-foreground"
                  onClick={onMarkAllAsRead}
                  disabled={markingAllSessionsRead}
                  title={t('sidebar.action.markAllRead')}
                  aria-label={t('sidebar.action.markAllRead')}
                  data-testid="workspace-mark-all-read-btn"
                >
                  {markingAllSessionsRead
                    ? <LoadingLine className="size-3 animate-spin" />
                    : <MailOpenIcon className="size-3" />}
                </Button>
              )}
              <Menu>
                <MenuTrigger
                  render={(
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        'size-6 text-muted-foreground/60 hover:bg-fill/70 hover:text-foreground',
                        (projectSortKey !== 'name'
                          || projectSortDirection !== 'asc'
                          || !projectPinnedFirst)
                        && 'text-foreground',
                      )}
                      title={t('sidebar.action.sort')}
                      aria-label={t('sidebar.action.sort')}
                      data-testid="workspace-sort-menu-trigger"
                    />
                  )}
                >
                  <ArrowUpDownIcon className="size-3" />
                </MenuTrigger>
                <MenuPopup align="end" side="bottom" sideOffset={4} className="w-48">
                  <MenuGroup>
                    <MenuGroupLabel>{t('sidebar.sort.by')}</MenuGroupLabel>
                    <MenuRadioGroup
                      value={projectSortKey}
                      onValueChange={value =>
                        setProjectSortKey(value as WorkspaceSidebarProjectSortKey)}
                    >
                      {PROJECT_SORT_OPTIONS.map(sortKey => (
                        <MenuRadioItem key={sortKey} value={sortKey}>
                          {t(`sidebar.sort.option.${sortKey}`)}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuGroup>
                  <MenuSeparator />
                  <MenuGroup>
                    <MenuGroupLabel>{t('sidebar.sort.direction')}</MenuGroupLabel>
                    <MenuRadioGroup
                      value={projectSortDirection}
                      onValueChange={value =>
                        setProjectSortDirection(value as WorkspaceSidebarProjectSortDirection)}
                    >
                      {PROJECT_SORT_DIRECTION_OPTIONS.map(direction => (
                        <MenuRadioItem key={direction} value={direction}>
                          {t(`sidebar.sort.direction.${direction}`)}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuGroup>
                  <MenuSeparator />
                  <MenuCheckboxItem
                    checked={projectPinnedFirst}
                    onCheckedChange={checked => setProjectPinnedFirst(checked)}
                  >
                    {t('sidebar.sort.pinnedFirst')}
                  </MenuCheckboxItem>
                </MenuPopup>
              </Menu>
              <Menu>
                <MenuTrigger
                  render={(
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        'size-6 text-muted-foreground/60 hover:bg-fill/70 hover:text-foreground',
                        projectFilter !== 'all' && 'text-foreground',
                      )}
                      title={t('sidebar.action.filter')}
                      aria-label={t('sidebar.action.filter')}
                      data-testid="workspace-filter-menu-trigger"
                    />
                  )}
                >
                  <ListFilterIcon className="size-3" />
                </MenuTrigger>
                <MenuPopup align="end" side="bottom" sideOffset={4} className="w-44">
                  <MenuGroup>
                    <MenuGroupLabel>{t('sidebar.filter.show')}</MenuGroupLabel>
                    <MenuRadioGroup
                      value={projectFilter}
                      onValueChange={value =>
                        setProjectFilter(value as WorkspaceSidebarProjectFilter)}
                    >
                      {PROJECT_FILTER_OPTIONS.map(filter => (
                        <MenuRadioItem key={filter} value={filter}>
                          {t(`sidebar.filter.option.${filter}`)}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuGroup>
                </MenuPopup>
              </Menu>
              {multiWorkspaceEnabled
? (
                <Menu>
                  <MenuTrigger
                    render={(
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 text-muted-foreground/60 hover:text-foreground hover:bg-fill/70"
                        disabled={adding}
                        title={t('sidebar.action.addProject')}
                        data-testid="add-workspace-menu-btn"
                      />
                    )}
                  >
                    <ChevronDownIcon className="size-3" />
                  </MenuTrigger>
                  <MenuPopup align="end" side="bottom" sideOffset={4} className="w-52">
                    <MenuItem onClick={onAddFromPicker} disabled={adding}>
                      <FolderPlusIcon className="size-3" />
                      {t('sidebar.action.addProject')}
                    </MenuItem>
                    <MenuItem onClick={onOpenMultiWorkspaceDialog}>
                      <FolderClosedIcon className="size-3" />
                      {t('sidebar.action.addMultiWorkspace')}
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              )
: (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 text-muted-foreground/60 hover:text-foreground hover:bg-fill/70"
                  onClick={onAddFromPicker}
                  disabled={adding}
                  title={t('sidebar.action.addProject')}
                  data-testid="add-workspace-btn"
                >
                  <PlusIcon className="size-3" />
                </Button>
              )}
            </div>
          </div>

          {/* Workspace list */}
          <nav className="flex min-w-0 flex-col gap-0.5 px-2 pb-2" data-testid="workspace-list">
            {workspaces.length === 0 && (
              <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                <div className="flex size-10 items-center justify-center rounded-xl bg-muted/60">
                  <FolderOpenIcon className="size-5 !text-muted-foreground/50" aria-hidden="true" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('sidebar.projects.empty.title')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('sidebar.projects.empty.description')}
                  </p>
                </div>
                {multiWorkspaceEnabled
? (
                  <Menu>
                    <MenuTrigger
                      render={(
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={adding}
                          className="mt-1 border-dashed"
                          data-testid="add-workspace-empty-menu-btn"
                        />
                      )}
                    >
                      <PlusIcon />
                      {t('sidebar.action.addProject')}
                    </MenuTrigger>
                    <MenuPopup align="center" side="bottom" sideOffset={4} className="w-52">
                      <MenuItem onClick={onAddFromPicker} disabled={adding}>
                        <FolderPlusIcon className="size-3" />
                        {t('sidebar.action.addProject')}
                      </MenuItem>
                      <MenuItem onClick={onOpenMultiWorkspaceDialog}>
                        <FolderClosedIcon className="size-3" />
                        {t('sidebar.action.addMultiWorkspace')}
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                )
: (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={onAddFromPicker}
                    disabled={adding}
                    className="mt-1 border-dashed"
                    data-testid="add-workspace-empty-btn"
                  >
                    <PlusIcon />
                    {t('sidebar.action.addProject')}
                  </Button>
                )}
              </div>
            )}
            {hasFilteredWorkspaces && (
              <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                <div className="flex size-9 items-center justify-center rounded-xl bg-muted/60">
                  <ListFilterIcon className="size-4 !text-muted-foreground/50" aria-hidden="true" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('sidebar.projects.filteredEmpty.title')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('sidebar.projects.filteredEmpty.description')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setProjectFilter('all')}
                  data-testid="workspace-filter-clear-btn"
                >
                  {t('sidebar.filter.clear')}
                </Button>
              </div>
            )}
            {visibleWorkspaces.map(workspace => (
              <WorkspaceGroup
                key={workspace.id}
                workspace={workspace}
                sessions={sessionsByWorkspaceId.get(workspace.id) ?? EMPTY_WORKSPACE_SESSIONS}
                projectFilter={projectFilter}
                runtimeIconByKind={runtimeIconByKind}
                onDelete={onDelete}
                onTogglePin={onTogglePin}
              />
            ))}
          </nav>
        </div>
      </PreviewCardProvider>
    )
  },
)
WorkspaceSidebarBody.displayName = 'WorkspaceSidebarBody'

export const WorkspaceSidebar = memo(({ collapsed = false }: { collapsed?: boolean }) => {
  const { t } = useTranslation('workspace')
  const pullRequestsActive = useIsActiveSurfaceId('pull-requests')
  const queryClient = useQueryClient()
  const { workspaces, ready: workspacesReady } = useWorkspaces()
  const { sessions } = useAllSessions()
  const { runtimes } = useRuntimeCatalog()
  const {
    addFromPicker,
    createFromLocator,
    adding,
    recognition,
    dismissRecognition,
    openAsCradleWorkspace,
    addAsSingleFolder,
  } = useAddWorkspace()
  const { remove } = useDeleteWorkspace()
  const { togglePin } = useToggleWorkspacePin()
  const [addWorkspaceDialogOpen, setAddWorkspaceDialogOpen] = useState(false)
  const [multiFolderDialogOpen, setMultiFolderDialogOpen] = useState(false)
  const multiWorkspaceEnabled = useFeatureFlag('multiWorkspacePoc')
  const localAuthForDangerousActions = useFeatureFlag('localAuthForDangerousActions')
  const { mutateAsync: createMultiFolderWorkspace, isPending: creatingMultiFolderWorkspace }
    = useMutation({
      ...postWorkspacesMultiFolderMutation(),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
    })
  const sessionsByWorkspaceId = useMemo(() => {
    const grouped = new Map<string, WorkspaceSession[]>()
    for (const session of sessions) {
      if (!session.workspaceId) {
        continue
      }

      const workspaceSessions = grouped.get(session.workspaceId)
      if (workspaceSessions) {
        workspaceSessions.push(session)
      }
 else {
        grouped.set(session.workspaceId, [session])
      }
    }
    return grouped
  }, [sessions])
  const unreadWorkspaceSessions = useMemo(
    () => sessions.filter(session => session.workspaceId !== null && session.unread),
    [sessions],
  )
  const { mutate: markAllSessionsRead, isPending: markingAllSessionsRead } = useMutation({
    mutationFn: async (sessionsToMarkRead: WorkspaceSession[]) => {
      return Promise.allSettled(
        sessionsToMarkRead.map(async (session) => {
          const { data, error } = await postSessionsByIdRead({ path: { id: session.id } })
          if (error) {
            throw error
          }
          if (!data) {
            throw new Error(`Marking session ${session.id} as read returned no data`)
          }
          updateSessionReadState(queryClient, data)
        }),
      )
    },
    onSuccess: (results) => {
      const failedCount = results.filter(result => result.status === 'rejected').length
      if (failedCount === 0) {
        toastManager.add({ type: 'success', title: t('sidebar.toast.markAllReadSuccess') })
        return
      }

      toastManager.add({
        type: failedCount === results.length ? 'error' : 'warning',
        title: t(
          failedCount === results.length
            ? 'sidebar.toast.markAllReadFailed'
            : 'sidebar.toast.markAllReadPartial',
        ),
      })
    },
  })
  const runtimeIconByKind = useMemo<RuntimeIconByKind>(() => {
    return new Map(runtimes.map(runtime => [runtime.runtimeKind, runtime.icon]))
  }, [runtimes])
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)
  const handleOpenSettings = useCallback(() => {
    setSettingsSection('appearance')
    openSettingsSection('appearance')
  }, [setSettingsSection])

  const handleDelete = useCallback(
    async (id: string) => {
      const workspace = workspaces.find(candidate => candidate.id === id)
      const authorized = await authorizeDangerousAction({
        action: 'remove',
        resource: 'workspace',
        label: workspace?.name ?? id,
        enabled: localAuthForDangerousActions,
      })
      if (!authorized) {
        return
      }
      remove({ path: { workspaceId: id } })
    },
    [localAuthForDangerousActions, remove, workspaces],
  )

  const handleToggleWorkspacePin = useCallback(
    (id: string, pinned: boolean) => {
      togglePin({ path: { workspaceId: id }, body: { pinned } })
    },
    [togglePin],
  )

  const handleMarkAllAsRead = useCallback(() => {
    if (unreadWorkspaceSessions.length > 0) {
      markAllSessionsRead(unreadWorkspaceSessions)
    }
  }, [markAllSessionsRead, unreadWorkspaceSessions])

  const handleCreateMultiFolderWorkspace = useCallback(
    async (input: { name: string, folders: Array<{ name: string, path: string }> }) => {
      try {
        await createMultiFolderWorkspace({
          body: input,
          throwOnError: true,
        })
        toastManager.add({ type: 'success', title: t('workspace.toast.multiFolderCreated') })
        setMultiFolderDialogOpen(false)
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: t('workspace.toast.multiFolderCreateFailed'),
          description: formatToastError(error),
        })
      }
    },
    [createMultiFolderWorkspace, t],
  )

  const handleOpenAsCradleWorkspace = useCallback(async () => {
    try {
      await openAsCradleWorkspace()
      toastManager.add({ type: 'success', title: t('workspace.toast.multiFolderCreated') })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.toast.recognitionOpenFailed'),
        description: formatToastError(error),
      })
    }
  }, [openAsCradleWorkspace, t])

  const handleAddAsSingleFolder = useCallback(async () => {
    try {
      await addAsSingleFolder()
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.toast.recognitionSingleFailed'),
        description: formatToastError(error),
      })
    }
  }, [addAsSingleFolder, t])

  const handleCreateRemoteWorkspace = useCallback(async (input: CreateWorkspaceInput) => {
    try {
      await createFromLocator(input)
      setAddWorkspaceDialogOpen(false)
      toastManager.add({
        type: 'success',
        title: t('workspace.toast.remoteWorkspaceCreated'),
      })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.toast.remoteWorkspaceCreateFailed'),
        description: formatToastError(error),
      })
    }
  }, [createFromLocator, t])

  const openSearch = useCallback(() => useGlobalSearchStore.getState().openSearch(), [])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Top navigation ── */}
      <TooltipProvider delayDuration={collapsed ? 0 : 600}>
        <nav className="flex flex-col gap-0.5 px-2 pt-1 pb-2">
          <TopNavItem
            icon={<WorkIcon className="size-3.5" />}
            label={t('nav.newWork')}
            collapsed={collapsed}
            onClick={openNewWork}
            dataTestId="nav-new-work"
          />
          <TopNavItem
            icon={<MessageSquarePlusIcon className="size-3.5" />}
            label={t('nav.newChat')}
            collapsed={collapsed}
            onClick={openNewChat}
            dataTestId="nav-new-chat"
          />
          <TopNavItem
            icon={<SearchIcon className="size-3.5" />}
            label={t('nav.search')}
            shortcut="⌘P"
            collapsed={collapsed}
            onClick={openSearch}
            dataTestId="nav-search"
          />
          <TopNavItem
            icon={<FileDiffIcon className="size-3.5" />}
            label={t('nav.diffs')}
            collapsed={collapsed}
            onClick={openDiff}
            dataTestId="nav-diffs"
          />
          <TopNavItem
            icon={<WorkIcon className="size-3.5" />}
            label={t('nav.pullRequests')}
            collapsed={collapsed}
            active={pullRequestsActive}
            onClick={openPullRequests}
            dataTestId="nav-pull-requests"
          />
          <TopNavItem
            icon={<CalendarClockIcon className="size-3.5" />}
            label={t('nav.automation')}
            collapsed={collapsed}
            onClick={openAutomation}
            dataTestId="nav-automation"
          />
          <TopNavItem
            icon={<BarChart3Icon className="size-3.5" />}
            label={t('nav.usage')}
            collapsed={collapsed}
            onClick={openUsage}
            dataTestId="nav-usage"
          />
          <TopNavItem
            icon={<SettingsIcon className="size-3.5" />}
            label={t('nav.settings')}
            shortcut="⌘,"
            collapsed={collapsed}
            onClick={handleOpenSettings}
            dataTestId="settings-btn"
          />
        </nav>
      </TooltipProvider>

      <ScrollArea
        scrollFade
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden [--scroll-area-fade-background:var(--sidebar)]"
        viewportClassName="min-w-0 max-w-full overflow-x-hidden"
        contentClassName="min-w-0 max-w-full overflow-x-hidden"
      >
        <div className={cn(collapsed ? 'hidden' : 'contents')}>
          <WorkspaceSidebarBody
            workspaces={workspaces}
            workspacesReady={workspacesReady}
            sessionsByWorkspaceId={sessionsByWorkspaceId}
            runtimeIconByKind={runtimeIconByKind}
            adding={adding}
            multiWorkspaceEnabled={multiWorkspaceEnabled}
            onAddFromPicker={() => setAddWorkspaceDialogOpen(true)}
            onOpenMultiWorkspaceDialog={() => setMultiFolderDialogOpen(true)}
            hasUnreadWorkspaceSessions={unreadWorkspaceSessions.length > 0}
            markingAllSessionsRead={markingAllSessionsRead}
            onMarkAllAsRead={handleMarkAllAsRead}
            onDelete={handleDelete}
            onTogglePin={handleToggleWorkspacePin}
          />
        </div>
      </ScrollArea>
      <WorkspaceMultiFolderDialog
        open={multiFolderDialogOpen && multiWorkspaceEnabled}
        creating={creatingMultiFolderWorkspace}
        onOpenChange={setMultiFolderDialogOpen}
        onCommit={handleCreateMultiFolderWorkspace}
      />
      <WorkspaceAddDialog
        open={addWorkspaceDialogOpen}
        creating={adding}
        onOpenChange={setAddWorkspaceDialogOpen}
        onAddLocal={addFromPicker}
        onCreateRemote={handleCreateRemoteWorkspace}
      />
      <WorkspaceRecognitionDialog
        recognition={recognition}
        busy={adding}
        onOpenChange={(open) => {
          if (!open) {
            dismissRecognition()
          }
        }}
        onOpenAsCradleWorkspace={handleOpenAsCradleWorkspace}
        onAddAsSingleFolder={handleAddAsSingleFolder}
      />
    </div>
  )
})
WorkspaceSidebar.displayName = 'WorkspaceSidebar'
