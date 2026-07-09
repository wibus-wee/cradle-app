import {
  ArrowDownLine as ChevronIcon,
  CheckLine as CheckIcon,
  ClockLine as ClockIcon,
  CopyLine as CopyIcon,
  DeleteLine as TrashIcon,
  FileLine as FileIcon,
  FolderLine as FolderIcon,
  GitBranchLine as BranchIcon,
  Home2Line as HomeIcon,
  LinkLine as LinkIcon,
  PencilLine as PencilIcon,
  PlusLine as PlusIcon,
  Refresh2Line as RefreshIcon,
  ServerLine as ServerIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getRelayServersOptions,
  getRemoteHostsByHostIdCradleServerHealthOptions,
  getRemoteHostsByHostIdCradleServerHealthQueryKey,
  getRemoteHostsOptions,
  getRemoteHostsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import {
  deleteRemoteHostsByHostId,
  patchRemoteHostsByHostId,
  postRemoteHosts,
  postRemoteHostsByHostIdCradleServerConnect,
  postRemoteHostsByHostIdCradleServerDisconnect,
  postRemoteHostsByHostIdCradleServerTest,
  postRemoteHostsByHostIdRelayClaim,
} from '~/api-gen/sdk.gen'
import type {
  GetRelayServersResponse,
  GetRemoteHostsResponse,
  PostRemoteHostsData,
} from '~/api-gen/types.gen'
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
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import {
  fetchRemoteUpstreamJson,
  remoteHostUpstreamQueryKey,
} from '~/features/remote-hosts/upstream-fetch'
import { cn } from '~/lib/cn'

import { HostEnrollmentsSection } from './host-enrollments-section'
import { RelayServersSection } from './relay-servers-settings-section'
import { SettingsGroup, SettingsPage } from './settings-container'

type Host = GetRemoteHostsResponse[number]
type ConnectionState = Host['connectionState']
type HostTransport = 'ssh' | 'direct-url' | 'relay'
type RelayServer = GetRelayServersResponse[number]

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

interface WorkspaceFileEntry {
  type: 'file' | 'directory'
  name: string
  path: string
}

interface RemoteWorkspaceFileInfo {
  name: string
  path: string
  size: number
  modifiedAt: number
  mimeType: string
  extension: string
  previewKind: 'text' | 'markdown' | 'image' | 'pdf' | 'office' | 'unsupported'
}

interface RemoteWorkspaceFileContent {
  content: string | null
}

function remoteHostWorkspacesQueryKey(hostId: string) {
  return remoteHostUpstreamQueryKey(hostId, 'workspaces')
}

function remoteHostFilesQueryKey(hostId: string, workspaceId: string, suffix: string, path = '') {
  return remoteHostUpstreamQueryKey(hostId, workspaceId, suffix, path)
}

type SettingsKey = keyof typeof import('~/locales/default').default.settings
type HostSaveBody = PostRemoteHostsData['body']

interface HostConnectionConfig {
  transport?: HostTransport
  baseUrl?: string
  ssh?: {
    hostName: string
    user?: string | null
    port?: number | string | null
    auth?: 'default' | 'identityFile'
    identityFilePath?: string | null
  }
  relay?: {
    relayServerId?: string | null
    relayUrl?: string | null
    roomId?: string | null
    pinnedHostPubkey?: string | null
    controllerKeyRef?: string | null
  }
  connectTimeoutMs?: number | string
}

interface HostCapabilities {
  cradleServer?: {
    enabled?: boolean
    remoteHost?: string
    remotePort?: number | string
  }
}

interface HostFormValues {
  displayName: string
  transport: HostTransport
  baseUrl: string
  sshHostName: string
  sshUser: string
  sshPort: string
  auth: 'default' | 'identityFile'
  identityFilePath: string
  relayServerId: string
  relayUrl: string
  relayRoomId: string
  relayPinnedHostPubkey: string
  relayControllerKeyRef: string
  remoteServerHost: string
  remoteServerPort: string
  connectTimeoutMs: string
  enabled: boolean
}

interface ConnectionDotSpec {
  tone: 'success' | 'muted' | 'danger'
  labelKey: SettingsKey
}

const DEFAULT_REMOTE_CRADLE_HOST = '127.0.0.1'
const DEFAULT_REMOTE_CRADLE_PORT = '21423'
const DEFAULT_CONNECT_TIMEOUT_MS = '15000'
const CUSTOM_RELAY_SERVER_VALUE = '__custom_relay_url__'
const MANAGED_LOCAL_RELAY_SERVER_ID = 'system:local-relayd'

const DOT_BG: Record<ConnectionDotSpec['tone'], string> = {
  success: 'bg-emerald-500',
  muted: 'bg-muted-foreground/40',
  danger: 'bg-destructive',
}

function readConnectionConfig(host: Host): HostConnectionConfig | null {
  if (!host.connectionConfigJson) {
    return null
  }
  try {
    return JSON.parse(host.connectionConfigJson) as HostConnectionConfig
  }
  catch {
    return null
  }
}

function readCapabilities(host: Host): HostCapabilities {
  if (!host.capabilitiesJson) {
    return {}
  }
  try {
    return JSON.parse(host.capabilitiesJson) as HostCapabilities
  }
  catch {
    return {}
  }
}

function hostTransport(host: Host): HostTransport {
  const transport = readConnectionConfig(host)?.transport
  if (transport === 'direct-url' || transport === 'relay') {
    return transport
  }
  return 'ssh'
}

function hostEndpointLabel(host: Host): string {
  const config = readConnectionConfig(host)
  if (config?.transport === 'direct-url') {
    return config.baseUrl ?? ''
  }
  if (config?.transport === 'relay') {
    const relay = config.relay
    return relay?.roomId
      ? `relay:${relay.roomId}`
      : relay?.relayUrl ?? relay?.relayServerId ?? ''
  }
  const ssh = config?.ssh
  if (!ssh) {
    return ''
  }
  const target = ssh.user ? `${ssh.user}@${ssh.hostName}` : ssh.hostName
  return ssh.port ? `${target}:${ssh.port}` : target
}

function cradleServerTargetLabel(host: Host): string {
  const config = readConnectionConfig(host)
  if (config?.transport === 'direct-url') {
    return config.baseUrl ?? ''
  }
  if (config?.transport === 'relay') {
    return hostEndpointLabel(host)
  }
  const cradleServer = readCapabilities(host).cradleServer
  return `${cradleServer?.remoteHost ?? DEFAULT_REMOTE_CRADLE_HOST}:${cradleServer?.remotePort ?? DEFAULT_REMOTE_CRADLE_PORT}`
}

function relayIsPaired(host: Host): boolean {
  const relay = readConnectionConfig(host)?.relay
  return Boolean(relay?.roomId && relay.pinnedHostPubkey && relay.controllerKeyRef)
}

function resolveHostRelayUrl(host: Host, relayServers: RelayServer[]): string | null {
  const relay = readConnectionConfig(host)?.relay
  if (!relay) {
    return null
  }
  if (relay.relayUrl) {
    return relay.relayUrl
  }
  if (relay.relayServerId) {
    return relayServers.find(server => server.id === relay.relayServerId)?.relayUrl ?? null
  }
  return null
}

function relayServerDisplayName(server: RelayServer, managedLocalName: string): string {
  return server.id === MANAGED_LOCAL_RELAY_SERVER_ID ? managedLocalName : server.displayName
}

function connectionDotSpec(state: ConnectionState): ConnectionDotSpec {
  switch (state) {
    case 'connected':
      return { tone: 'success', labelKey: 'remoteHosts.state.connected' }
    case 'offline':
      return { tone: 'danger', labelKey: 'remoteHosts.state.offline' }
    case 'idle':
    default:
      return { tone: 'muted', labelKey: 'remoteHosts.state.idle' }
  }
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) {
      return message
    }
  }
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function parseOptionalInteger(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatBytes(size: number | null): string | null {
  if (size == null) {
    return null
  }
  if (size < 1024) {
    return `${size} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

function formatTimestamp(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) {
    return null
  }
  return new Date(ms).toLocaleString()
}

function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  if (!trimmed || trimmed === '/') {
    return ''
  }
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '' : trimmed.slice(0, index)
}

function ConnectionDot({ state }: { state: ConnectionState }) {
  const { t } = useTranslation('settings')
  const spec = connectionDotSpec(state)
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="relative flex size-2 shrink-0 items-center justify-center" aria-hidden="true">
        <span className={cn('relative inline-flex size-2 rounded-full', DOT_BG[spec.tone])} />
      </span>
      {t(spec.labelKey)}
    </span>
  )
}

function TransportBadge({ transport }: { transport: HostTransport }) {
  const { t } = useTranslation('settings')
  const isDirectUrl = transport === 'direct-url'
  const isRelay = transport === 'relay'
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-4 px-1.5 text-[9px] font-normal',
        {
          'border-sky-500/30 text-sky-600 dark:text-sky-400': isDirectUrl,
          'border-emerald-500/30 text-emerald-600 dark:text-emerald-400': isRelay,
          'border-border text-muted-foreground': !isDirectUrl && !isRelay,
        },
      )}
    >
      {t(isDirectUrl ? 'remoteHosts.transport.directUrl' : isRelay ? 'remoteHosts.transport.relay' : 'remoteHosts.transport.ssh')}
    </Badge>
  )
}

function CopyCodeButton({ command }: { command: string }) {
  const { t } = useTranslation('settings')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      toastManager.add({ type: 'success', title: t('remoteHosts.guide.commandCopied') })
      setTimeout(setCopied, 1500, false)
    }
    catch {
      toastManager.add({ type: 'error', title: t('remoteHosts.guide.copyFailed') })
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-muted/40">
      <pre className="break-all whitespace-pre-wrap px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground/85">
        <code>{command}</code>
      </pre>
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={copy}
        aria-label={t('remoteHosts.guide.copy')}
        className="absolute right-1.5 top-1.5"
      >
        {copied
          ? <CheckIcon className="size-3.5 text-emerald-500" aria-hidden="true" />
          : <CopyIcon className="size-3.5" aria-hidden="true" />}
      </Button>
    </div>
  )
}

function GuideStep({ index, title, isLast, children }: { index: number, title: string, isLast?: boolean, children: React.ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!isLast && <span className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-border/70" aria-hidden="true" />}
      <span className="relative z-10 mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold text-foreground">
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[12.5px] font-medium leading-tight text-foreground">{title}</p>
        {children}
      </div>
    </li>
  )
}

function SetupGuide({ onAdd }: { onAdd?: () => void }) {
  const { t } = useTranslation('settings')
  return (
    <div className="space-y-4">
      <ol className="space-y-0">
        <GuideStep index={1} title={t('remoteHosts.guide.step1.title')}>
          <p className="text-[12px] leading-relaxed text-muted-foreground/80">
            {t('remoteHosts.guide.step1.detail')}
          </p>
        </GuideStep>
        <GuideStep index={2} title={t('remoteHosts.guide.step2.title')}>
          <p className="text-[12px] leading-relaxed text-muted-foreground/80">
            {t('remoteHosts.guide.step2.detail')}
          </p>
          {onAdd && (
            <Button size="sm" onClick={onAdd}>
              <PlusIcon className="size-3.5" aria-hidden="true" />
              {t('remoteHosts.action.addHost')}
            </Button>
          )}
        </GuideStep>
        <GuideStep index={3} isLast title={t('remoteHosts.guide.step3.title')}>
          <p className="text-[12px] leading-relaxed text-muted-foreground/80">
            {t('remoteHosts.guide.step3.detail')}
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground/70">
            {t('remoteHosts.guide.relayNote')}
          </p>
        </GuideStep>
      </ol>
    </div>
  )
}

function RemoteHostsEmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation('settings')
  return (
    <div className="flex flex-col items-center gap-7 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-foreground/5 text-foreground/70">
        <ServerIcon className="size-5" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          {t('remoteHosts.empty.title')}
        </h2>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {t('remoteHosts.guide.intro')}
        </p>
      </div>
      <div className="w-full max-w-md text-left">
        <SetupGuide onAdd={onAdd} />
      </div>
      <Button size="sm" onClick={onAdd}>
        <PlusIcon className="size-3.5" aria-hidden="true" />
        {t('remoteHosts.action.addHost')}
      </Button>
    </div>
  )
}

function DetailSection({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{label}</h4>
      {children}
    </div>
  )
}

function EmptyInline({ text }: { text: string }) {
  return <p className="text-[11.5px] text-muted-foreground/60">{text}</p>
}

function FilePreview({ hostId, workspaceId, entry }: { hostId: string, workspaceId: string, entry: WorkspaceFileEntry }) {
  const { t } = useTranslation('settings')
  const path = entry.path
  const infoQuery = useQuery({
    queryKey: remoteHostFilesQueryKey(hostId, workspaceId, 'info', path),
    queryFn: () => fetchRemoteUpstreamJson<RemoteWorkspaceFileInfo | null>(
      hostId,
      `/workspaces/${encodeURIComponent(workspaceId)}/files/info?path=${encodeURIComponent(path)}`,
    ),
    enabled: entry.type === 'file',
    retry: false,
  })
  const contentQuery = useQuery({
    queryKey: remoteHostFilesQueryKey(hostId, workspaceId, 'content', path),
    queryFn: () => fetchRemoteUpstreamJson<RemoteWorkspaceFileContent>(
      hostId,
      `/workspaces/${encodeURIComponent(workspaceId)}/files/content?path=${encodeURIComponent(path)}`,
    ),
    enabled: entry.type === 'file',
    retry: false,
  })

  if (entry.type !== 'file') {
    return null
  }

  const info = infoQuery.data
  const content = contentQuery.data?.content
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-card/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-mono text-[11.5px] text-foreground/85">{entry.path}</p>
          {info && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal">{info.previewKind}</Badge>
              {formatBytes(info.size) && <span>{formatBytes(info.size)}</span>}
              {formatTimestamp(info.modifiedAt) && (
                <span className="inline-flex items-center gap-1">
                  <ClockIcon className="size-3" aria-hidden="true" />
                  {formatTimestamp(info.modifiedAt)}
                </span>
              )}
            </div>
          )}
        </div>
        {(infoQuery.isLoading || contentQuery.isLoading) && <Spinner className="size-3.5" />}
      </div>

      {infoQuery.isError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {describeError(infoQuery.error)}
        </p>
      )}
      {contentQuery.isError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {describeError(contentQuery.error)}
        </p>
      )}
      {content != null
        ? (
            <pre className="max-h-52 overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-[11px] leading-relaxed text-foreground/80">
              {content}
            </pre>
          )
        : !contentQuery.isLoading && <EmptyInline text={t('remoteHosts.files.noPreview')} />}
    </div>
  )
}

function WorkspaceFiles({ hostId, workspace }: { hostId: string, workspace: RemoteWorkspace }) {
  const { t } = useTranslation('settings')
  const [currentPath, setCurrentPath] = useState('')
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileEntry | null>(null)

  useEffect(() => {
    setCurrentPath('')
    setSelectedFile(null)
  }, [workspace.id])

  const rootQuery = useQuery({
    queryKey: remoteHostFilesQueryKey(hostId, workspace.id, 'root'),
    queryFn: () => fetchRemoteUpstreamJson<WorkspaceFileEntry[]>(
      hostId,
      `/workspaces/${encodeURIComponent(workspace.id)}/files`,
    ),
    enabled: currentPath.length === 0,
    retry: false,
  })
  const childrenQuery = useQuery({
    queryKey: remoteHostFilesQueryKey(hostId, workspace.id, 'children', currentPath),
    queryFn: () => fetchRemoteUpstreamJson<WorkspaceFileEntry[]>(
      hostId,
      `/workspaces/${encodeURIComponent(workspace.id)}/files/children?path=${encodeURIComponent(currentPath)}`,
    ),
    enabled: currentPath.length > 0,
    retry: false,
  })

  const activeQuery = currentPath.length === 0 ? rootQuery : childrenQuery
  const files = activeQuery.data ?? []
  const directories = files.filter(file => file.type === 'directory')
  const regularFiles = files.filter(file => file.type === 'file')

  const goTo = (path: string) => {
    setCurrentPath(path)
    setSelectedFile(null)
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10.5px] text-muted-foreground/70" title={currentPath || workspace.locator.path}>
          {currentPath || workspace.locator.path}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={!currentPath}
            onClick={() => goTo(parentPath(currentPath))}
            aria-label={t('remoteHosts.files.up')}
          >
            <ChevronIcon className="size-3.5 rotate-90" aria-hidden="true" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => goTo('')}
            aria-label={t('remoteHosts.files.root')}
          >
            <HomeIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {activeQuery.isLoading
        ? <EmptyInline text={t('remoteHosts.detail.loading')} />
        : activeQuery.isError
          ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                {describeError(activeQuery.error)}
              </p>
            )
          : files.length === 0
            ? <EmptyInline text={t('remoteHosts.files.empty')} />
            : (
                <div className="max-h-64 overflow-y-auto rounded-md border border-border/60">
                  {[...directories, ...regularFiles].map(entry => (
                    <WorkspaceFileRow
                      key={entry.path}
                      entry={entry}
                      selected={selectedFile?.path === entry.path}
                      onOpen={() => entry.type === 'directory' ? goTo(entry.path) : setSelectedFile(entry)}
                    />
                  ))}
                </div>
              )}

      {selectedFile && <FilePreview hostId={hostId} workspaceId={workspace.id} entry={selectedFile} />}
    </div>
  )
}

function WorkspaceFileRow({ entry, selected, onOpen }: { entry: WorkspaceFileEntry, selected: boolean, onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-2 border-b border-border/40 px-2 py-1.5 text-left last:border-b-0 hover:bg-muted/40',
        selected && 'bg-muted/50',
      )}
    >
      {entry.type === 'directory'
        ? <FolderIcon className="size-3.5 shrink-0 text-sky-500/80" aria-hidden="true" />
        : <FileIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
      <span className="truncate text-[11.5px] text-foreground/85">{entry.name}</span>
    </button>
  )
}

function WorkspaceList({ host }: { host: Host }) {
  const { t } = useTranslation('settings')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const workspacesQuery = useQuery({
    queryKey: remoteHostWorkspacesQueryKey(host.id),
    queryFn: () => fetchRemoteUpstreamJson<RemoteWorkspace[]>(host.id, '/workspaces'),
    enabled: host.connectionState === 'connected',
    retry: false,
  })
  const workspaces = workspacesQuery.data ?? []
  const selectedWorkspace = useMemo(() => {
    return workspaces.find(workspace => workspace.id === selectedWorkspaceId) ?? workspaces[0] ?? null
  }, [selectedWorkspaceId, workspaces])

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length > 0) {
      setSelectedWorkspaceId(workspaces[0].id)
    }
  }, [selectedWorkspaceId, workspaces])

  if (workspacesQuery.isLoading) {
    return <EmptyInline text={t('remoteHosts.detail.loading')} />
  }
  if (workspacesQuery.isError) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
        {describeError(workspacesQuery.error)}
      </p>
    )
  }
  if (workspaces.length === 0) {
    return <EmptyInline text={t('remoteHosts.detail.noWorkspaces')} />
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="rounded-md border border-border/60">
        {workspaces.map(workspace => (
          <button
            key={workspace.id}
            type="button"
            onClick={() => setSelectedWorkspaceId(workspace.id)}
            className={cn(
              'flex w-full flex-col gap-1 border-b border-border/40 px-2.5 py-2 text-left last:border-b-0 hover:bg-muted/40',
              selectedWorkspace?.id === workspace.id && 'bg-muted/50',
            )}
          >
            <span className="truncate text-[11.5px] font-medium text-foreground/85">{workspace.name}</span>
            <span className="truncate font-mono text-[10.5px] text-muted-foreground/70">{workspace.locator.path}</span>
            {workspace.gitIdentity.branch && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
                <BranchIcon className="size-3" aria-hidden="true" />
                {workspace.gitIdentity.branch}
              </span>
            )}
          </button>
        ))}
      </div>
      {selectedWorkspace && <WorkspaceFiles hostId={host.id} workspace={selectedWorkspace} />}
    </div>
  )
}

function HostDetail({ host }: { host: Host }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const connected = host.connectionState === 'connected'
  const healthQuery = useQuery({
    ...getRemoteHostsByHostIdCradleServerHealthOptions({ path: { hostId: host.id } }),
    enabled: connected,
    retry: false,
  })

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: getRemoteHostsByHostIdCradleServerHealthQueryKey({ path: { hostId: host.id } }) })
    void queryClient.invalidateQueries({ queryKey: remoteHostWorkspacesQueryKey(host.id) })
  }

  if (!connected) {
    return (
      <p className="text-[11.5px] text-muted-foreground/70">
        {t('remoteHosts.detail.connectToBrowse')}
      </p>
    )
  }

  const health = healthQuery.data?.health
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <ConnectionDot state={host.connectionState} />
          <span className="font-mono text-[11px] text-muted-foreground/70">{cradleServerTargetLabel(host)}</span>
          {health && (
            <span className="text-[11px] text-muted-foreground/70">
              {t('remoteHosts.health.uptime', { seconds: Math.round(health.uptime) })}
            </span>
          )}
        </div>
        <Button size="icon-xs" variant="ghost" onClick={refreshAll} aria-label={t('remoteHosts.action.refresh')}>
          <RefreshIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {host.lastError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          {host.lastError}
        </p>
      )}

      <DetailSection label={t('remoteHosts.detail.health')}>
        {healthQuery.isLoading
          ? <EmptyInline text={t('remoteHosts.detail.loading')} />
          : healthQuery.isError
            ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                  {describeError(healthQuery.error)}
                </p>
              )
            : health
              ? (
                  <div className="grid gap-2 text-[11.5px] text-muted-foreground sm:grid-cols-3">
                    <div className="rounded-md border border-border/60 bg-card/60 px-2.5 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60">RSS</div>
                      <div className="font-mono text-foreground/80">{formatBytes(health.memory.rss)}</div>
                    </div>
                    <div className="rounded-md border border-border/60 bg-card/60 px-2.5 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Heap</div>
                      <div className="font-mono text-foreground/80">{formatBytes(health.memory.heapUsed)}</div>
                    </div>
                    <div className="rounded-md border border-border/60 bg-card/60 px-2.5 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60">CPU</div>
                      <div className="font-mono text-foreground/80">{health.cpu.percent == null ? '-' : `${health.cpu.percent.toFixed(1)}%`}</div>
                    </div>
                  </div>
                )
              : <EmptyInline text={t('remoteHosts.health.unavailable')} />}
      </DetailSection>

      <DetailSection label={t('remoteHosts.detail.workspaces')}>
        <WorkspaceList host={host} />
      </DetailSection>
    </div>
  )
}

function initialHostFormValues(host?: Host): HostFormValues {
  const config = host ? readConnectionConfig(host) : null
  const capabilities = host ? readCapabilities(host) : {}
  const ssh = config?.ssh
  const relay = config?.relay
  const cradleServer = capabilities.cradleServer
  return {
    displayName: host?.displayName ?? '',
    transport: config?.transport === 'direct-url' || config?.transport === 'relay' ? config.transport : 'ssh',
    baseUrl: config?.baseUrl ?? '',
    sshHostName: ssh?.hostName ?? '',
    sshUser: ssh?.user ?? '',
    sshPort: ssh?.port == null ? '' : String(ssh.port),
    auth: ssh?.auth ?? 'default',
    identityFilePath: ssh?.identityFilePath ?? '',
    relayServerId: relay?.relayServerId ?? '',
    relayUrl: relay?.relayUrl ?? '',
    relayRoomId: relay?.roomId ?? '',
    relayPinnedHostPubkey: relay?.pinnedHostPubkey ?? '',
    relayControllerKeyRef: relay?.controllerKeyRef ?? '',
    remoteServerHost: cradleServer?.remoteHost ?? DEFAULT_REMOTE_CRADLE_HOST,
    remoteServerPort: cradleServer?.remotePort == null ? DEFAULT_REMOTE_CRADLE_PORT : String(cradleServer.remotePort),
    connectTimeoutMs: config?.connectTimeoutMs == null ? DEFAULT_CONNECT_TIMEOUT_MS : String(config.connectTimeoutMs),
    enabled: host?.enabled ?? true,
  }
}

function buildHostSaveBody(values: HostFormValues): HostSaveBody {
  if (values.transport === 'direct-url') {
    return {
      displayName: values.displayName.trim(),
      enabled: values.enabled,
      connectionConfig: {
        transport: 'direct-url',
        baseUrl: values.baseUrl.trim(),
        connectTimeoutMs: parseOptionalInteger(values.connectTimeoutMs),
      },
      capabilities: {
        cradleServer: { enabled: true },
      },
    }
  }

  if (values.transport === 'relay') {
    const relayServerId = values.relayServerId.trim()
    const relayUrl = values.relayUrl.trim()
    return {
      displayName: values.displayName.trim(),
      enabled: values.enabled,
      connectionConfig: {
        transport: 'relay',
        connectTimeoutMs: parseOptionalInteger(values.connectTimeoutMs),
        relay: {
          relayServerId: relayServerId || null,
          relayUrl: relayServerId ? null : relayUrl || null,
          roomId: values.relayRoomId || null,
          pinnedHostPubkey: values.relayPinnedHostPubkey || null,
          controllerKeyRef: values.relayControllerKeyRef || null,
        },
      },
      capabilities: {
        cradleServer: { enabled: true },
      },
    }
  }

  return {
    displayName: values.displayName.trim(),
    enabled: values.enabled,
    connectionConfig: {
      transport: 'ssh',
      ssh: {
        hostName: values.sshHostName.trim(),
        user: values.sshUser.trim() || null,
        port: parseOptionalInteger(values.sshPort) ?? null,
        auth: values.auth,
        identityFilePath: values.auth === 'identityFile' ? values.identityFilePath.trim() : null,
      },
      connectTimeoutMs: parseOptionalInteger(values.connectTimeoutMs),
    },
    capabilities: {
      cradleServer: {
        enabled: true,
        remoteHost: values.remoteServerHost.trim() || DEFAULT_REMOTE_CRADLE_HOST,
        remotePort: parseOptionalInteger(values.remoteServerPort) ?? Number(DEFAULT_REMOTE_CRADLE_PORT),
      },
    },
  }
}

function HostFormDialog({ open, onOpenChange, host }: { open: boolean, onOpenChange: (open: boolean) => void, host?: Host }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [values, setValues] = useState<HostFormValues>(() => initialHostFormValues(host))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const { data: relayServers = [] } = useQuery(getRelayServersOptions())
  const managedLocalRelayName = t('remoteHosts.relayServers.managedLocalName')
  const enabledRelayServers: RelayServer[] = relayServers.filter(server => server.enabled)
  const defaultRelayServer = enabledRelayServers.find(server => server.isDefault) ?? enabledRelayServers[0]

  useEffect(() => {
    if (open) {
      setValues(initialHostFormValues(host))
      setAdvancedOpen(false)
    }
  }, [open, host])

  const set = (patch: Partial<HostFormValues>) => setValues(prev => ({ ...prev, ...patch }))

  const selectTransport = (next: string) => {
    if (!next) {
      return
    }
    const transport = next as HostTransport
    if (transport === 'relay' && !values.relayServerId && !values.relayUrl.trim() && defaultRelayServer) {
      set({ transport, relayServerId: defaultRelayServer.id })
      return
    }
    set({ transport })
  }

  const valid = values.displayName.trim().length > 0
    && (values.transport === 'direct-url'
      ? values.baseUrl.trim().length > 0
      : values.transport === 'relay'
        ? values.relayServerId.trim().length > 0 || values.relayUrl.trim().length > 0
        : values.sshHostName.trim().length > 0
          && values.remoteServerHost.trim().length > 0
          && values.remoteServerPort.trim().length > 0
          && (values.auth === 'default' || values.identityFilePath.trim().length > 0))

  const save = useMutation({
    mutationFn: async () => {
      const body = buildHostSaveBody(values)
      if (host) {
        const { error } = await patchRemoteHostsByHostId({ path: { hostId: host.id }, body })
        if (error) {
          throw error
        }
        return
      }
      const { error } = await postRemoteHosts({ body })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t(host ? 'remoteHosts.toast.updated' : 'remoteHosts.toast.created') })
      void queryClient.invalidateQueries({ queryKey: getRemoteHostsQueryKey() })
      onOpenChange(false)
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.saveFailed'),
      description: describeError(error),
    }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(host ? 'remoteHosts.form.editTitle' : 'remoteHosts.form.addTitle')}</DialogTitle>
          <DialogDescription>{t('remoteHosts.form.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="rh-display-name" className="text-xs">{t('remoteHosts.form.displayName')}</Label>
            <Input
              id="rh-display-name"
              value={values.displayName}
              onChange={e => set({ displayName: e.target.value })}
              placeholder={t('remoteHosts.form.displayNamePlaceholder')}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t('remoteHosts.form.transport')}</Label>
            <ToggleGroup
              type="single"
              value={values.transport}
              onValueChange={selectTransport}
              className="w-full"
            >
              <ToggleGroupItem value="ssh" size="sm" className="flex-1 text-xs">
                {t('remoteHosts.form.transportSsh')}
              </ToggleGroupItem>
              <ToggleGroupItem value="direct-url" size="sm" className="flex-1 text-xs">
                {t('remoteHosts.form.transportDirectUrl')}
              </ToggleGroupItem>
              <ToggleGroupItem value="relay" size="sm" className="flex-1 text-xs">
                {t('remoteHosts.form.transportRelay')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {values.transport === 'direct-url'
            ? (
                <div className="space-y-2">
                  <Label htmlFor="rh-base-url" className="text-xs">{t('remoteHosts.form.baseUrl')}</Label>
                  <Input
                    id="rh-base-url"
                    value={values.baseUrl}
                    onChange={e => set({ baseUrl: e.target.value })}
                    placeholder={t('remoteHosts.form.baseUrlPlaceholder')}
                    className="h-8 font-mono text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">{t('remoteHosts.form.baseUrlHint')}</p>
                </div>
              )
            : values.transport === 'relay'
              ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label className="text-xs">{t('remoteHosts.relay.dialog.relayServer')}</Label>
                      <Select
                        value={values.relayServerId || CUSTOM_RELAY_SERVER_VALUE}
                        onValueChange={(next) => {
                          if (next === CUSTOM_RELAY_SERVER_VALUE) {
                            set({ relayServerId: '' })
                            return
                          }
                          set({ relayServerId: next, relayUrl: '' })
                        }}
                      >
                        <SelectTrigger className="h-8 w-full text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {enabledRelayServers.map(server => (
                            <SelectItem key={server.id} value={server.id}>
                              {relayServerDisplayName(server, managedLocalRelayName)}
                              {server.isDefault ? ` · ${t('remoteHosts.relayServers.badge.default')}` : ''}
                            </SelectItem>
                          ))}
                          <SelectItem value={CUSTOM_RELAY_SERVER_VALUE}>{t('remoteHosts.relay.dialog.relayUrl')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {!values.relayServerId && (
                      <div className="space-y-2">
                        <Label htmlFor="rh-relay-url" className="text-xs">{t('remoteHosts.relay.dialog.relayUrl')}</Label>
                        <Input
                          id="rh-relay-url"
                          value={values.relayUrl}
                          onChange={e => set({ relayUrl: e.target.value })}
                          placeholder={t('remoteHosts.relay.dialog.relayUrlPlaceholder')}
                          className="h-8 font-mono text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground">{t('remoteHosts.relay.dialog.relayUrlHint')}</p>
                      </div>
                    )}

                    <p className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      {t('remoteHosts.form.relayNote')}
                    </p>
                  </div>
                )
            : (
                <>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                    <div className="space-y-2">
                      <Label htmlFor="rh-ssh-host" className="text-xs">{t('remoteHosts.form.remoteAddress')}</Label>
                      <Input
                        id="rh-ssh-host"
                        value={values.sshHostName}
                        onChange={e => set({ sshHostName: e.target.value })}
                        placeholder={t('remoteHosts.form.remoteAddressPlaceholder')}
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rh-ssh-port" className="text-xs">{t('remoteHosts.form.sshPort')}</Label>
                      <Input
                        id="rh-ssh-port"
                        value={values.sshPort}
                        onChange={e => set({ sshPort: e.target.value })}
                        placeholder="22"
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="rh-username" className="text-xs">{t('remoteHosts.form.username')}</Label>
                    <Input
                      id="rh-username"
                      value={values.sshUser}
                      onChange={e => set({ sshUser: e.target.value })}
                      placeholder={t('remoteHosts.form.usernamePlaceholder')}
                      className="h-8 font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">{t('remoteHosts.form.auth')}</Label>
                    <Select value={values.auth} onValueChange={next => set({ auth: next as HostFormValues['auth'] })}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">{t('remoteHosts.form.authDefault')}</SelectItem>
                        <SelectItem value="identityFile">{t('remoteHosts.form.authIdentityFile')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {values.auth === 'identityFile' && (
                    <div className="space-y-2">
                      <Label htmlFor="rh-identity-file" className="text-xs">{t('remoteHosts.form.identityFile')}</Label>
                      <Input
                        id="rh-identity-file"
                        value={values.identityFilePath}
                        onChange={e => set({ identityFilePath: e.target.value })}
                        placeholder={t('remoteHosts.form.identityFilePlaceholder')}
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                    <div className="space-y-2">
                      <Label htmlFor="rh-cradle-host" className="text-xs">{t('remoteHosts.form.remoteServerHost')}</Label>
                      <Input
                        id="rh-cradle-host"
                        value={values.remoteServerHost}
                        onChange={e => set({ remoteServerHost: e.target.value })}
                        placeholder={DEFAULT_REMOTE_CRADLE_HOST}
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rh-cradle-port" className="text-xs">{t('remoteHosts.form.remoteServerPort')}</Label>
                      <Input
                        id="rh-cradle-port"
                        value={values.remoteServerPort}
                        onChange={e => set({ remoteServerPort: e.target.value })}
                        placeholder={DEFAULT_REMOTE_CRADLE_PORT}
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                  </div>
                </>
              )}

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronIcon className={cn('size-3.5 transition-transform', advancedOpen ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
                {t('remoteHosts.form.advanced')}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-3">
              <Label htmlFor="rh-timeout" className="text-xs">{t('remoteHosts.form.connectTimeoutMs')}</Label>
              <Input
                id="rh-timeout"
                value={values.connectTimeoutMs}
                onChange={e => set({ connectTimeoutMs: e.target.value })}
                placeholder={DEFAULT_CONNECT_TIMEOUT_MS}
                className="h-8 font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">{t('remoteHosts.form.connectTimeoutMsHint')}</p>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-2.5">
            <div className="space-y-0.5">
              <Label className="text-xs">{t('remoteHosts.form.enabled')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('remoteHosts.form.enabledHint')}</p>
            </div>
            <Switch checked={values.enabled} onCheckedChange={enabled => set({ enabled })} size="sm" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
            {t('remoteHosts.action.cancel')}
          </Button>
          <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()} className="h-7 text-xs">
            {save.isPending && <Spinner className="size-3.5" />}
            {t(host ? 'remoteHosts.action.save' : 'remoteHosts.action.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PairComputerWizard({ open, onOpenChange, onReveal }: { open: boolean, onOpenChange: (open: boolean) => void, onReveal?: (hostId: string) => void }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [values, setValues] = useState<HostFormValues>(() => ({ ...initialHostFormValues(), transport: 'relay' }))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [pairingString, setPairingString] = useState('')
  const [step, setStep] = useState<'config' | 'success'>('config')
  const [connectState, setConnectState] = useState<'idle' | 'connecting' | 'connected' | 'failed'>('idle')
  const [createdHostId, setCreatedHostId] = useState<string | null>(null)
  const [createdName, setCreatedName] = useState('')
  const { data: relayServers = [] } = useQuery(getRelayServersOptions())
  const managedLocalRelayName = t('remoteHosts.relayServers.managedLocalName')
  const enabledRelayServers: RelayServer[] = relayServers.filter(server => server.enabled)
  const defaultRelayServer = enabledRelayServers.find(server => server.isDefault) ?? enabledRelayServers[0]

  useEffect(() => {
    if (open) {
      setValues({ ...initialHostFormValues(), transport: 'relay' })
      setAdvancedOpen(false)
      setPairingString('')
      setStep('config')
      setConnectState('idle')
      setCreatedHostId(null)
      setCreatedName('')
    }
  }, [open])

  const set = (patch: Partial<HostFormValues>) => setValues(prev => ({ ...prev, ...patch }))

  // Default relay transport to the built-in / default relay server.
  useEffect(() => {
    if (values.transport === 'relay' && !values.relayServerId && !values.relayUrl.trim() && defaultRelayServer) {
      set({ relayServerId: defaultRelayServer.id })
    }
  }, [values.transport, values.relayServerId, values.relayUrl, defaultRelayServer])

  const relayUrl = values.relayServerId
    ? enabledRelayServers.find(server => server.id === values.relayServerId)?.relayUrl ?? ''
    : values.relayUrl.trim()
  const enrollmentCommand = values.transport === 'relay' && relayUrl
    ? `cradle relay-transport host-enrollment create --displayName "${values.displayName || 'Cradle host'}" --relayUrl "${relayUrl}"`
    : null

  const valid = values.displayName.trim().length > 0
    && (values.transport === 'direct-url'
      ? values.baseUrl.trim().length > 0
      : values.transport === 'relay'
        ? (values.relayServerId.trim().length > 0 || values.relayUrl.trim().length > 0) && pairingString.trim().length > 0
        : values.sshHostName.trim().length > 0
          && values.remoteServerHost.trim().length > 0
          && values.remoteServerPort.trim().length > 0
          && (values.auth === 'default' || values.identityFilePath.trim().length > 0))

  const connect = useMutation({
    mutationFn: async (hostId: string) => {
      const { error } = await postRemoteHostsByHostIdCradleServerConnect({ path: { hostId } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      setConnectState('connected')
      void queryClient.invalidateQueries({ queryKey: getRemoteHostsQueryKey() })
    },
    onError: () => setConnectState('failed'),
  })

  const submit = useMutation({
    mutationFn: async () => {
      const body = buildHostSaveBody(values)
      const { data, error } = await postRemoteHosts({ body })
      if (error) {
        throw error
      }
      if (!data) {
        throw new Error('No host returned')
      }
      const host = data
      if (values.transport === 'relay') {
        const { error: claimError } = await postRemoteHostsByHostIdRelayClaim({
          path: { hostId: host.id },
          body: { pairingString: pairingString.trim() },
        })
        if (claimError) {
          throw claimError
        }
        return { host, isRelay: true }
      }
      return { host, isRelay: false }
    },
    onSuccess: ({ host, isRelay }) => {
      if (isRelay) {
        setCreatedHostId(host.id)
        setCreatedName(host.displayName)
        setStep('success')
        setConnectState('connecting')
        void queryClient.invalidateQueries({ queryKey: getRemoteHostsQueryKey() })
        connect.mutate(host.id)
        return
      }
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.created') })
      void queryClient.invalidateQueries({ queryKey: getRemoteHostsQueryKey() })
      onOpenChange(false)
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.saveFailed'),
      description: describeError(error),
    }),
  })

  const submitLabel = values.transport === 'relay'
    ? t('remoteHosts.action.completePairing')
    : t('remoteHosts.action.add')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {step === 'success'
          ? (
              <>
                <DialogHeader>
                  <DialogTitle>{t('remoteHosts.wizard.success.title')}</DialogTitle>
                  <DialogDescription>
                    {t('remoteHosts.wizard.success.body', { name: createdName })}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
                  {connectState === 'connecting' && <Spinner className="size-3.5" />}
                  {connectState === 'connecting' && t('remoteHosts.wizard.success.connecting')}
                  {connectState === 'connected' && (
                    <span className="text-emerald-600 dark:text-emerald-400">{t('remoteHosts.wizard.success.connected')}</span>
                  )}
                  {connectState === 'failed' && (
                    <span className="text-destructive">{t('remoteHosts.wizard.success.connectFailed')}</span>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
                    {t('remoteHosts.action.done')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={connectState !== 'connected' || !createdHostId}
                    onClick={() => {
                      if (createdHostId) {
                        onReveal?.(createdHostId)
                      }
                      onOpenChange(false)
                    }}
                    className="h-7 text-xs"
                  >
                    {t('remoteHosts.action.openWorkspaces')}
                  </Button>
                </DialogFooter>
              </>
            )
          : (
              <>
                <DialogHeader>
                  <DialogTitle>{t('remoteHosts.wizard.title')}</DialogTitle>
                  <DialogDescription>{t('remoteHosts.wizard.description')}</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-1">
                  <div className="space-y-2">
                    <Label className="text-xs">{t('remoteHosts.form.transport')}</Label>
                    <ToggleGroup
                      type="single"
                      value={values.transport}
                      onValueChange={(next) => {
                        if (next) {
                          set({ transport: next as HostTransport })
                        }
                      }}
                      className="w-full"
                    >
                      <ToggleGroupItem value="relay" size="sm" className="flex-1 text-xs">
                        {t('remoteHosts.wizard.pathRelay')}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="direct-url" size="sm" className="flex-1 text-xs">
                        {t('remoteHosts.wizard.pathDirectUrl')}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="ssh" size="sm" className="flex-1 text-xs">
                        {t('remoteHosts.wizard.pathSsh')}
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <p className="text-[11px] text-muted-foreground">
                      {values.transport === 'relay'
                        ? t('remoteHosts.wizard.pathRelayHint')
                        : values.transport === 'direct-url'
                          ? t('remoteHosts.wizard.pathDirectUrlHint')
                          : t('remoteHosts.wizard.pathSshHint')}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="rh-wizard-name" className="text-xs">{t('remoteHosts.wizard.computerName')}</Label>
                    <Input
                      id="rh-wizard-name"
                      value={values.displayName}
                      onChange={e => set({ displayName: e.target.value })}
                      placeholder={t('remoteHosts.wizard.computerNamePlaceholder')}
                      className="h-8 text-xs"
                      autoFocus
                    />
                  </div>

                  {values.transport === 'direct-url'
                    ? (
                        <div className="space-y-2">
                          <Label htmlFor="rh-base-url" className="text-xs">{t('remoteHosts.form.baseUrl')}</Label>
                          <Input
                            id="rh-base-url"
                            value={values.baseUrl}
                            onChange={e => set({ baseUrl: e.target.value })}
                            placeholder={t('remoteHosts.form.baseUrlPlaceholder')}
                            className="h-8 font-mono text-xs"
                          />
                          <p className="text-[11px] text-muted-foreground">{t('remoteHosts.form.baseUrlHint')}</p>
                        </div>
                      )
                    : values.transport === 'relay'
                      ? (
                          <div className="space-y-3">
                            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                              <CollapsibleTrigger asChild>
                                <button
                                  type="button"
                                  className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                                >
                                  <ChevronIcon className={cn('size-3.5 transition-transform', advancedOpen ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
                                  {t('remoteHosts.form.advanced')}
                                </button>
                              </CollapsibleTrigger>
                              <CollapsibleContent className="space-y-2 pt-3">
                                <Label className="text-xs">{t('remoteHosts.relay.dialog.relayServer')}</Label>
                                <Select
                                  value={values.relayServerId || CUSTOM_RELAY_SERVER_VALUE}
                                  onValueChange={(next) => {
                                    if (next === CUSTOM_RELAY_SERVER_VALUE) {
                                      set({ relayServerId: '' })
                                      return
                                    }
                                    set({ relayServerId: next, relayUrl: '' })
                                  }}
                                >
                                  <SelectTrigger className="h-8 w-full text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {enabledRelayServers.map(server => (
                                      <SelectItem key={server.id} value={server.id}>
                                        {relayServerDisplayName(server, managedLocalRelayName)}
                                        {server.isDefault ? ` · ${t('remoteHosts.relayServers.badge.default')}` : ''}
                                      </SelectItem>
                                    ))}
                                    <SelectItem value={CUSTOM_RELAY_SERVER_VALUE}>{t('remoteHosts.relay.dialog.relayUrl')}</SelectItem>
                                  </SelectContent>
                                </Select>
                                {!values.relayServerId && (
                                  <Input
                                    value={values.relayUrl}
                                    onChange={e => set({ relayUrl: e.target.value })}
                                    placeholder={t('remoteHosts.relay.dialog.relayUrlPlaceholder')}
                                    className="h-8 font-mono text-xs"
                                  />
                                )}
                              </CollapsibleContent>
                            </Collapsible>

                            {enrollmentCommand
                              ? (
                                  <ol className="space-y-0">
                                    <GuideStep index={1} title={t('remoteHosts.wizard.enrollmentCommandTitle')}>
                                      <p className="text-[12px] leading-relaxed text-muted-foreground/80">
                                        {t('remoteHosts.wizard.enrollmentCommandHint')}
                                      </p>
                                      <CopyCodeButton command={enrollmentCommand} />
                                    </GuideStep>
                                    <GuideStep index={2} isLast title={t('remoteHosts.relay.dialog.pairingStepTitle')}>
                                      <p className="text-[12px] leading-relaxed text-muted-foreground/80">
                                        {t('remoteHosts.relay.dialog.pairingCodeHint')}
                                      </p>
                                      <Input
                                        value={pairingString}
                                        onChange={event => setPairingString(event.target.value)}
                                        placeholder={t('remoteHosts.relay.dialog.pairingCodePlaceholder')}
                                        className="h-8 font-mono text-xs"
                                      />
                                    </GuideStep>
                                  </ol>
                                )
                              : (
                                  <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                                    {t('remoteHosts.relay.dialog.noRelayUrl')}
                                  </p>
                                )}
                          </div>
                        )
                      : (
                          <>
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                              <div className="space-y-2">
                                <Label htmlFor="rh-ssh-host" className="text-xs">{t('remoteHosts.form.remoteAddress')}</Label>
                                <Input
                                  id="rh-ssh-host"
                                  value={values.sshHostName}
                                  onChange={e => set({ sshHostName: e.target.value })}
                                  placeholder={t('remoteHosts.form.remoteAddressPlaceholder')}
                                  className="h-8 font-mono text-xs"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="rh-ssh-port" className="text-xs">{t('remoteHosts.form.sshPort')}</Label>
                                <Input
                                  id="rh-ssh-port"
                                  value={values.sshPort}
                                  onChange={e => set({ sshPort: e.target.value })}
                                  placeholder="22"
                                  className="h-8 font-mono text-xs"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="rh-username" className="text-xs">{t('remoteHosts.form.username')}</Label>
                              <Input
                                id="rh-username"
                                value={values.sshUser}
                                onChange={e => set({ sshUser: e.target.value })}
                                placeholder={t('remoteHosts.form.usernamePlaceholder')}
                                className="h-8 font-mono text-xs"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">{t('remoteHosts.form.auth')}</Label>
                              <Select value={values.auth} onValueChange={next => set({ auth: next as HostFormValues['auth'] })}>
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="default">{t('remoteHosts.form.authDefault')}</SelectItem>
                                  <SelectItem value="identityFile">{t('remoteHosts.form.authIdentityFile')}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {values.auth === 'identityFile' && (
                              <div className="space-y-2">
                                <Label htmlFor="rh-identity-file" className="text-xs">{t('remoteHosts.form.identityFile')}</Label>
                                <Input
                                  id="rh-identity-file"
                                  value={values.identityFilePath}
                                  onChange={e => set({ identityFilePath: e.target.value })}
                                  placeholder={t('remoteHosts.form.identityFilePlaceholder')}
                                  className="h-8 font-mono text-xs"
                                />
                              </div>
                            )}
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                              <div className="space-y-2">
                                <Label htmlFor="rh-cradle-host" className="text-xs">{t('remoteHosts.form.remoteServerHost')}</Label>
                                <Input
                                  id="rh-cradle-host"
                                  value={values.remoteServerHost}
                                  onChange={e => set({ remoteServerHost: e.target.value })}
                                  placeholder={DEFAULT_REMOTE_CRADLE_HOST}
                                  className="h-8 font-mono text-xs"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="rh-cradle-port" className="text-xs">{t('remoteHosts.form.remoteServerPort')}</Label>
                                <Input
                                  id="rh-cradle-port"
                                  value={values.remoteServerPort}
                                  onChange={e => set({ remoteServerPort: e.target.value })}
                                  placeholder={DEFAULT_REMOTE_CRADLE_PORT}
                                  className="h-8 font-mono text-xs"
                                />
                              </div>
                            </div>
                          </>
                        )}
                </div>

                <DialogFooter>
                  <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
                    {t('remoteHosts.action.cancel')}
                  </Button>
                  <Button size="sm" disabled={!valid || submit.isPending} onClick={() => submit.mutate()} className="h-7 text-xs">
                    {submit.isPending && <Spinner className="size-3.5" />}
                    {submitLabel}
                  </Button>
                </DialogFooter>
              </>
            )}
      </DialogContent>
    </Dialog>
  )
}

function RelayClaimDialog({ host, open, onOpenChange, onOpenWorkspaces }: { host: Host, open: boolean, onOpenChange: (open: boolean) => void, onOpenWorkspaces?: () => void }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [pairingString, setPairingString] = useState('')
  const [step, setStep] = useState<'pair' | 'success'>('pair')
  const [connectState, setConnectState] = useState<'idle' | 'connecting' | 'connected' | 'failed'>('idle')
  const { data: relayServers = [] } = useQuery(getRelayServersOptions())

  const relayUrl = resolveHostRelayUrl(host, relayServers)
  const enrollmentCommand = relayUrl
    ? `cradle relay-transport host-enrollment create --displayName "${host.displayName}" --relayUrl "${relayUrl}"`
    : null

  useEffect(() => {
    if (open) {
      setPairingString('')
      setStep('pair')
      setConnectState('idle')
    }
  }, [open])

  const connect = useMutation({
    mutationFn: async () => {
      const { error } = await postRemoteHostsByHostIdCradleServerConnect({ path: { hostId: host.id } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      setConnectState('connected')
      void queryClient.invalidateQueries({ queryKey: getRemoteHostsQueryKey() })
    },
    onError: () => setConnectState('failed'),
  })

  const claim = useMutation({
    mutationFn: async () => {
      const { error } = await postRemoteHostsByHostIdRelayClaim({
        path: { hostId: host.id },
        body: { pairingString: pairingString.trim() },
      })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.relay.toast.pairingComplete') })
      void queryClient.invalidateQueries({ queryKey: getRemoteHostsQueryKey() })
      setStep('success')
      setConnectState('connecting')
      connect.mutate()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.relay.toast.pairingFailed'),
      description: describeError(error),
    }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {step === 'success'
          ? (
              <>
                <DialogHeader>
                  <DialogTitle>{t('remoteHosts.wizard.success.title')}</DialogTitle>
                  <DialogDescription>
                    {t('remoteHosts.wizard.success.body', { name: host.displayName })}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
                  {connectState === 'connecting' && <Spinner className="size-3.5" />}
                  {connectState === 'connecting' && t('remoteHosts.wizard.success.connecting')}
                  {connectState === 'connected' && (
                    <span className="text-emerald-600 dark:text-emerald-400">{t('remoteHosts.wizard.success.connected')}</span>
                  )}
                  {connectState === 'failed' && (
                    <span className="text-destructive">{t('remoteHosts.wizard.success.connectFailed')}</span>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenChange(false)}
                    className="h-7 text-xs"
                  >
                    {t('remoteHosts.action.done')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={connectState !== 'connected'}
                    onClick={() => {
                      onOpenWorkspaces?.()
                      onOpenChange(false)
                    }}
                    className="h-7 text-xs"
                  >
                    {t('remoteHosts.action.openWorkspaces')}
                  </Button>
                </DialogFooter>
              </>
            )
          : (
              <>
                <DialogHeader>
                  <DialogTitle>{t('remoteHosts.relay.dialog.title')}</DialogTitle>
                  <DialogDescription>{t('remoteHosts.relay.dialog.description')}</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-1">
                  {enrollmentCommand
                    ? (
                        <ol className="space-y-0">
                          <GuideStep index={1} title={t('remoteHosts.relay.dialog.commandTitle')}>
                            <p className="text-[12px] leading-relaxed text-muted-foreground/80">
                              {t('remoteHosts.relay.dialog.commandHint')}
                            </p>
                            <CopyCodeButton command={enrollmentCommand} />
                          </GuideStep>
                          <GuideStep index={2} isLast title={t('remoteHosts.relay.dialog.pairingStepTitle')}>
                            <p className="text-[12px] leading-relaxed text-muted-foreground/80">
                              {t('remoteHosts.relay.dialog.pairingCodeHint')}
                            </p>
                            <Input
                              id="rh-relay-pairing-string"
                              value={pairingString}
                              onChange={event => setPairingString(event.target.value)}
                              placeholder={t('remoteHosts.relay.dialog.pairingCodePlaceholder')}
                              className="h-8 font-mono text-xs"
                            />
                          </GuideStep>
                        </ol>
                      )
                    : (
                        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                          {t('remoteHosts.relay.dialog.noRelayUrl')}
                        </p>
                      )}
                </div>

                <DialogFooter>
                  <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
                    {t('remoteHosts.action.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={pairingString.trim().length === 0 || claim.isPending || !enrollmentCommand}
                    onClick={() => claim.mutate()}
                    className="h-7 text-xs"
                  >
                    {claim.isPending && <Spinner className="size-3.5" />}
                    {t(claim.isPending ? 'remoteHosts.relay.dialog.claiming' : 'remoteHosts.relay.dialog.claim')}
                  </Button>
                </DialogFooter>
              </>
            )}
      </DialogContent>
    </Dialog>
  )
}

function HostRow({ host, reveal }: { host: Host, reveal?: boolean }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [claimingRelay, setClaimingRelay] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)

  // When the page asks to reveal this host (e.g. after a wizard pairing),
  // expand the row and scroll it into view.
  useEffect(() => {
    if (reveal) {
      setExpanded(true)
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [reveal])

  const invalidateHosts = () => {
    void queryClient.invalidateQueries({ queryKey: getRemoteHostsQueryKey() })
  }

  const connect = useMutation({
    mutationFn: async () => {
      const { error } = await postRemoteHostsByHostIdCradleServerConnect({ path: { hostId: host.id } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.connected') })
      invalidateHosts()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.connectFailed'),
      description: describeError(error),
    }),
  })

  const disconnect = useMutation({
    mutationFn: async () => {
      const { error } = await postRemoteHostsByHostIdCradleServerDisconnect({ path: { hostId: host.id } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.disconnected') })
      invalidateHosts()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.disconnectFailed'),
      description: describeError(error),
    }),
  })

  const deleteHost = useMutation({
    mutationFn: async () => {
      const { error } = await deleteRemoteHostsByHostId({ path: { hostId: host.id } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.deleted') })
      invalidateHosts()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.deleteFailed'),
      description: describeError(error),
    }),
  })

  const testCradleServer = useMutation({
    mutationFn: async () => {
      const { error } = await postRemoteHostsByHostIdCradleServerTest({ path: { hostId: host.id } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.cradleServerOk') })
      invalidateHosts()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.cradleServerFailed'),
      description: describeError(error),
    }),
  })

  const transport = hostTransport(host)
  const isRelay = transport === 'relay'
  const relayPaired = !isRelay || relayIsPaired(host)
  const isConnected = host.connectionState === 'connected'
  const busy = connect.isPending || disconnect.isPending || deleteHost.isPending || testCradleServer.isPending
  const tunnelActionDisabled = busy || !host.enabled || !relayPaired

  return (
    <div data-testid={`remote-host-row-${host.id}`} ref={rowRef}>
      <div className="group flex items-center gap-3 px-3.5 py-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <ServerIcon className="size-3.5" aria-hidden="true" />
        </div>
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[12.5px] font-medium text-foreground">{host.displayName}</span>
              <TransportBadge transport={transport} />
              {!host.enabled && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal text-muted-foreground">
                  {t('remoteHosts.badge.disabled')}
                </Badge>
              )}
              {isRelay && !relayPaired && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal text-muted-foreground">
                  {t('remoteHosts.relay.noRoom')}
                </Badge>
              )}
              <ConnectionDot state={host.connectionState} />
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground/70">
              {hostEndpointLabel(host)}
            </div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {isConnected
            ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-7 px-2.5 text-[11px]"
                  disabled={busy}
                  onClick={() => disconnect.mutate()}
                >
                  {disconnect.isPending ? <Spinner className="size-3" /> : null}
                  {t('remoteHosts.action.disconnect')}
                </Button>
              )
            : isRelay && !relayPaired
              ? (
                  <Button
                    size="xs"
                    className="h-7 px-2.5 text-[11px]"
                    disabled={busy}
                    onClick={() => setClaimingRelay(true)}
                  >
                    <LinkIcon className="size-3" aria-hidden="true" />
                    {t('remoteHosts.action.completePairing')}
                  </Button>
                )
              : (
                  <Button
                    size="xs"
                    variant="outline"
                    className="h-7 px-2.5 text-[11px]"
                    disabled={tunnelActionDisabled}
                    onClick={() => connect.mutate()}
                  >
                    {connect.isPending ? <Spinner className="size-3" /> : null}
                    {t('remoteHosts.action.connect')}
                  </Button>
                )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => testCradleServer.mutate()}
                disabled={tunnelActionDisabled}
                aria-label={t('remoteHosts.action.testCradleServer')}
              >
                {testCradleServer.isPending ? <Spinner className="size-3.5" /> : <RefreshIcon className="size-3.5" aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('remoteHosts.action.testCradleServer')}</TooltipContent>
          </Tooltip>

          {isRelay && relayPaired && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => setClaimingRelay(true)}
                  disabled={busy || isConnected}
                  aria-label={t('remoteHosts.action.pairRelay')}
                >
                  <LinkIcon className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('remoteHosts.action.pairRelay')}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-xs" variant="ghost" onClick={() => setEditing(true)} aria-label={t('remoteHosts.action.edit')}>
                <PencilIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('remoteHosts.action.edit')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                aria-label={t('remoteHosts.action.delete')}
              >
                {deleteHost.isPending ? <Spinner className="size-3.5" /> : <TrashIcon className="size-3.5" aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('remoteHosts.action.delete')}</TooltipContent>
          </Tooltip>

          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setExpanded(value => !value)}
            aria-label={expanded ? t('remoteHosts.action.collapse') : t('remoteHosts.action.expand')}
          >
            <ChevronIcon className={cn('size-3.5 transition-transform', expanded ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/60 bg-muted/20 px-3.5 py-3.5">
          <HostDetail host={host} />
        </div>
      )}

      {editing && <HostFormDialog open onOpenChange={open => !open && setEditing(false)} host={host} />}
      {claimingRelay && (
        <RelayClaimDialog
          host={host}
          open
          onOpenChange={open => !open && setClaimingRelay(false)}
          onOpenWorkspaces={() => setExpanded(true)}
        />
      )}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('remoteHosts.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('remoteHosts.delete.description', { name: host.displayName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('remoteHosts.action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteHost.mutate()}>
              {t('remoteHosts.action.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function RemoteHostsSettings() {
  const { t } = useTranslation('settings')
  const [addOpen, setAddOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [revealHostId, setRevealHostId] = useState<string | null>(null)
  const { data: hosts = [], isLoading } = useQuery(getRemoteHostsOptions())

  return (
    <SettingsPage
      title={t('remoteHosts.page.title')}
      description={t('remoteHosts.page.description')}
      action={(
        <Button data-testid="add-remote-host-btn" size="sm" onClick={() => setAddOpen(true)}>
          <PlusIcon className="size-3.5" aria-hidden="true" />
          {t('remoteHosts.action.addHost')}
        </Button>
      )}
      data-testid="remote-hosts-settings"
    >
      <HostEnrollmentsSection />

      {isLoading
        ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-10 text-[12px] text-muted-foreground">
              <Spinner className="size-3.5" />
              {t('remoteHosts.loading')}
            </div>
          )
        : hosts.length === 0
          ? <RemoteHostsEmptyState onAdd={() => setAddOpen(true)} />
          : (
              <>
                <Collapsible open={guideOpen} onOpenChange={setGuideOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ChevronIcon className={cn('size-3.5 transition-transform', guideOpen ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
                      {t('remoteHosts.guide.toggle')}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4">
                    <div className="rounded-xl border border-border bg-card p-5">
                      <SetupGuide onAdd={() => setAddOpen(true)} />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <SettingsGroup
                  label={t('remoteHosts.group.otherComputers')}
                  description={t('remoteHosts.group.otherComputers.description')}
                  bare
                  className="[&>*+*]:border-t [&>*+*]:border-border/60"
                >
                  {hosts.map(host => (
                    <HostRow key={host.id} host={host} reveal={revealHostId === host.id} />
                  ))}
                </SettingsGroup>
              </>
            )}

      <RelayServersSection />

      <PairComputerWizard open={addOpen} onOpenChange={setAddOpen} onReveal={setRevealHostId} />
    </SettingsPage>
  )
}
