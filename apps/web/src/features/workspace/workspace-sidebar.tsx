import {
  CalendarTimeAddLine as CalendarClockIcon,
  ChartBar2Line as BarChart3Icon,
  Chat1Line as MessageSquarePlusIcon,
  CopyLine as ClipboardCopyIcon,
  CopyLine as CopyIcon,
  DeleteLine as Trash2Icon,
  DownSmallLine as ChevronDownIcon,
  ExternalLinkLine as ExternalLinkIcon,
  FileNewLine as FilePlusIcon,
  FilterLine as ListFilterIcon,
  FolderLine as FolderClosedIcon,
  FolderOpenLine as FolderOpenIcon,
  GitCompareLine as FileDiffIcon,
  GitPullRequestLine as WorkIcon,
  LoadingLine,
  MailOpenLine as MailOpenIcon,
  NewFolderLine as FolderPlusIcon,
  PencilLine as PencilIcon,
  PinLine as PinIcon,
  PinLine as PinOffIcon,
  PlusLine as PlusIcon,
  Refresh1Line as RefreshCwIcon,
  SearchLine as SearchIcon,
  Settings2Line as SettingsIcon,
  TransferVerticalLine as ArrowUpDownIcon,
} from '@mingcute/react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { shallow } from 'zustand/shallow'

import {
  patchSessionsById,
  postSessionsByIdRead,
} from '~/api-gen'
import {
  getRemoteHostsOptions,
  getSessionsByIdQueryKey,
  patchWorkspacesByWorkspaceIdLocationMutation,
  patchWorkspacesByWorkspaceIdMutation,
  postWorkspacesByWorkspaceIdFilesFileMutation,
  postWorkspacesByWorkspaceIdFilesFolderMutation,
  postWorkspacesMultiFolderMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetRemoteHostsResponse,
} from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
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
import { useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { runtimeSessionStatusQueryOptions } from '~/features/chat/commands/runtime-session-status-command'
import { prefetchChatSession } from '~/features/chat/session/chat-session-prefetch'
import { useDirectoryPicker } from '~/features/filesystem/directory-picker-provider'
import { KanbanSidebar } from '~/features/kanban/kanban-sidebar'
import { PluginsSidebar } from '~/features/plugins/plugins-sidebar'
import {
  fetchRemoteUpstreamJson,
  remoteHostUpstreamQueryKey,
} from '~/features/remote-hosts/upstream-fetch'
import { useGlobalSearchStore } from '~/features/search/global-search-store'
import { useFeatureFlag } from '~/features/settings/use-app-preferences'
import { useWorkspaceWorks } from '~/features/work/use-work'
import { MigrateWorkspaceDialog } from '~/features/workspace/migrate-workspace-dialog'
import { ensureRemoteWorkspaceForPath } from '~/features/workspace/remote-workspace-import'
import type { Workspace } from '~/features/workspace/types'
import { getLocalWorkspacePath, getWorkspaceLocationLabel } from '~/features/workspace/types'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'
import { authorizeDangerousAction, isElectron, nativeIpc } from '~/lib/electron'
import { useIsActiveSurfaceId } from '~/navigation/active-surface'
import {
  openAutomation,
  openDiff,
  openNewChat,
  openNewWork,
  openPullRequests,
  openSettingsSection,
  openUsage,
  openWorkspaceDetail,
} from '~/navigation/navigation-commands'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import { PreviewCardProvider } from './preview-card/preview-card-provider'
import type { WorkspaceSession } from './use-session'
import { sessionsQueryKey, updateSessionReadState, useAllSessions } from './use-session'
import type { WorkspaceSessionGroup } from './use-session-group'
import {
  useAddSessionGroupMembers,
  useCreateSessionGroup,
  useDeleteSessionGroup,
  useRemoveSessionGroupMember,
  useSessionGroups,
  useUpdateSessionGroup,
} from './use-session-group'
import type { CreateWorkspaceInput } from './use-workspace'
import {
  useAddWorkspace,
  useDeleteWorkspace,
  useToggleWorkspacePin,
  useWorkspaces,
  WORKSPACES_QUERY_KEY,
} from './use-workspace'
import { WorkspaceGroupDisclosure } from './workspace-group-disclosure'
import type { WorkspaceMenuAction } from './workspace-group-disclosure-view'
import {
  WorkspaceMultiFolderDialog,
} from './workspace-multi-folder-dialog'
import {
  WorkspaceRecognitionDialogView,
} from './workspace-recognition-dialog-view'
import { WorkspaceSessionActionsMenu } from './workspace-session-actions-menu'
import type {
  WorkspaceSessionActionsMenuState,
} from './workspace-session-actions-menu-state'
import {
  CLOSED_WORKSPACE_SESSION_ACTIONS_MENU_STATE,
} from './workspace-session-actions-menu-state'
import {
  partitionWorkspaceSessions,
} from './workspace-session-group-partition'
import { WorkspaceSessionGroupSection } from './workspace-session-groups'
import type { WorkspaceSessionItemMenuRequest } from './workspace-session-item'
import type {
  WorkspaceSessionAttentionKind,
} from './workspace-session-item-view'
import type { WorkspaceRuntimeIconByKind } from './workspace-session-list-section'
import { WorkspaceSessionListSection } from './workspace-session-list-section'
import { isWorkspaceSessionRunning } from './workspace-session-status'
import type {
  WorkspaceSidebarProjectFilter,
  WorkspaceSidebarProjectSortDirection,
  WorkspaceSidebarProjectSortKey,
} from './workspace-sidebar-ui-store'
import { useWorkspaceSidebarUiStore } from './workspace-sidebar-ui-store'
import {
  WorkspaceTextInputDialogView,
} from './workspace-text-input-dialog-view'

const RECENT_SESSION_WINDOW_SECONDS = 60 * 60
const DEFAULT_WORKSPACE_FILE_NAME = 'untitled'
const DEFAULT_WORKSPACE_FOLDER_NAME = 'untitled-folder'
const EMPTY_WORKSPACES: Workspace[] = []
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

type SessionAttentionKind = WorkspaceSessionAttentionKind

function useSessionAttentionBySessionId(
  sessions: readonly WorkspaceSession[],
  locallyStreamingSessionIds: Set<string>,
): Map<string, SessionAttentionKind> {
  const activeSessionIds = useMemo(
    () => sessions
      .filter(session => isWorkspaceSessionRunning(session, locallyStreamingSessionIds))
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

type RuntimeIconByKind = WorkspaceRuntimeIconByKind

type SessionMenuRequest = WorkspaceSessionItemMenuRequest

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
  const workspaces = workspacesQuery.data ?? EMPTY_WORKSPACES
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
      = useState<WorkspaceSessionActionsMenuState>(
        CLOSED_WORKSPACE_SESSION_ACTIONS_MENU_STATE,
      )
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
          = (isWorkspaceSessionRunning(b, locallyStreamingSessionIds) ? 1 : 0)
            - (isWorkspaceSessionRunning(a, locallyStreamingSessionIds) ? 1 : 0)
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
          = (isWorkspaceSessionRunning(b, locallyStreamingSessionIds) ? 1 : 0)
            - (isWorkspaceSessionRunning(a, locallyStreamingSessionIds) ? 1 : 0)
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
            isWorkspaceSessionRunning(session, locallyStreamingSessionIds)
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
        open && current.anchor
          ? { ...current, open: true }
          : CLOSED_WORKSPACE_SESSION_ACTIONS_MENU_STATE)
    }, [])

    useEffect(() => {
      const next = new Set<string>()

      for (const sessionId of acknowledgedSessionIdsRef.current!) {
        const session = sessionsById.get(sessionId)
        if (
          session
          && isWorkspaceSessionRunning(session, locallyStreamingSessionIds)
        ) {
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
            <WorkspaceTextInputDialogView
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
            <WorkspaceTextInputDialogView
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
            <WorkspaceTextInputDialogView
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
            <WorkspaceTextInputDialogView
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
            <WorkspaceSessionActionsMenu
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
  return sessions.some(session =>
    isWorkspaceSessionRunning(session, locallyStreamingSessionIds))
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
      return isWorkspaceSessionRunning(session, locallyStreamingSessionIds)
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
      <WorkspaceRecognitionDialogView
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
