// Remote hosts settings — a guided, To-C take on the feature.
//
// This is a private-preview capability: Cradle runs a small agent daemon
// (`cradle-agentd`) on a remote machine and reaches it over SSH. The UI
// intentionally hides transport internals (local forwarded socket paths,
// daemon host ids, arch) and shows users only what they need:
//   - A friendly name and the SSH target they already use
//   - A 3-step setup guide the first time they arrive (and on demand after)
//   - Connect / disconnect, and a clean view of what the remote host offers
//     (runtimes, workspaces, live agents) once connected
//
// Socket paths are daemon deployment details. The remote socket path stays in
// an "Advanced" disclosure for non-default setups; the local forwarded socket
// path is a server-side concern and is never exposed here.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLine as ChevronIcon,
  ArrowRightLine as GoIcon,
  ArrowUpLine as UpIcon,
  CheckLine as CheckIcon,
  ClockLine as ClockIcon,
  CopyLine as CopyIcon,
  DeleteLine as TrashIcon,
  FileLine as FileIcon,
  FolderLine as FolderIcon,
  GitBranchLine as BranchIcon,
  Home2Line as HomeIcon,
  PencilLine as PencilIcon,
  PlusLine as PlusIcon,
  Refresh2Line as RefreshIcon,
  RouteLine as RelayIcon,
  ServerLine as ServerIcon,
} from '@mingcute/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getRelayServersOptions,
  getRelayServersQueryKey,
  getRemoteHostsByHostIdAgentdAgentsOptions,
  getRemoteHostsByHostIdAgentdAgentsQueryKey,
  getRemoteHostsByHostIdAgentdFsDirectoryOptions,
  getRemoteHostsByHostIdAgentdFsDirectoryQueryKey,
  getRemoteHostsByHostIdAgentdFsStatOptions,
  getRemoteHostsByHostIdAgentdGitRepositoryOptions,
  getRemoteHostsByHostIdAgentdHealthOptions,
  getRemoteHostsByHostIdAgentdHealthQueryKey,
  getRemoteHostsByHostIdAgentdRuntimesOptions,
  getRemoteHostsByHostIdAgentdRuntimesQueryKey,
  getRemoteHostsOptions,
  getRemoteHostsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import {
  deleteRelayServersByRelayServerId,
  deleteRemoteHostsByHostId,
  patchRelayServersByRelayServerId,
  patchRemoteHostsByHostId,
  postRelayServers,
  postRemoteHosts,
  postRemoteHostsByHostIdAgentdConnect,
  postRemoteHostsByHostIdAgentdDisconnect,
  postRemoteHostsByHostIdCradleServerTest,
  postRemoteHostsByHostIdRelayClaim,
  postRemoteHostsByHostIdRelayPairingToken,
} from '~/api-gen/sdk.gen'
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
import { cn } from '~/lib/cn'

import { SettingsGroup, SettingsPage } from './settings-container'

import type {
  GetRelayServersResponse,
  GetRemoteHostsByHostIdAgentdFsDirectoryResponse,
  GetRemoteHostsByHostIdAgentdFsStatResponse,
  GetRemoteHostsByHostIdAgentdGitRepositoryResponse,
  GetRemoteHostsResponse,
} from '~/api-gen/types.gen'

type Host = GetRemoteHostsResponse[number]
type RelayServer = GetRelayServersResponse[number]
type ConnectionState = Host['connectionState']
type HostTransport = 'ssh' | 'direct-socket' | 'relay'

/**
 * The host's transport lives inside `connectionConfigJson` (a JSON string the
 * server stores verbatim). We parse it here only to read the transport kind and
 * the public relay coordinates/state. WebSocket tokens are intentionally never
 * persisted in this config.
 */
interface HostConnectionConfig {
  transport?: HostTransport
  ssh?: {
    hostName: string
    user?: string | null
    port?: number | null
    auth?: 'default' | 'identityFile'
    identityFilePath?: string | null
  }
  relay?: { relayUrl: string, enrollmentId?: string, lastSessionRoomId?: string }
}

interface HostCapabilities {
  agentd?: {
    remoteSocketPath?: string
    lastDaemonHostId?: string | null
    lastDaemonVersion?: string | null
    lastPlatform?: string | null
    lastArch?: string | null
  }
  cradleServer?: {
    enabled?: boolean
    remoteHost?: string
    remotePort?: number
  }
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

function hostTransport(host: Host): HostTransport {
  const cfg = readConnectionConfig(host)
  if (cfg?.transport) {
    return cfg.transport
  }
  return 'ssh'
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

function sshLabel(host: Host): string {
  const ssh = readConnectionConfig(host)?.ssh
  if (!ssh) {
    return ''
  }
  return ssh.user ? `${ssh.user}@${ssh.hostName}` : ssh.hostName
}

/** Short, non-sensitive label for the current relay room id (e.g. room_a1b2c3d4… -> a1b2c3d4). */
function shortRoomId(roomId?: string | null): string | null {
  if (!roomId) {
    return null
  }
  return roomId.replace(/^room_/, '').slice(0, 8)
}

function quoteTerminalArg(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

type SettingsKey = keyof typeof import('~/locales/default').default.settings

const DEFAULT_REMOTE_SOCKET_PATH = '~/.cradle/agentd/agent.sock'

/** The daemon client throws the parsed error body (a plain object), not an Error. */
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

interface ConnectionDotSpec {
  tone: 'success' | 'warn' | 'muted' | 'danger'
  pulse: boolean
  labelKey: SettingsKey
}

function connectionDotSpec(state: ConnectionState): ConnectionDotSpec {
  switch (state) {
    case 'connected':
      return { tone: 'success', pulse: false, labelKey: 'remoteHosts.state.connected' }
    case 'connecting':
      return { tone: 'warn', pulse: true, labelKey: 'remoteHosts.state.connecting' }
    case 'offline':
      return { tone: 'danger', pulse: false, labelKey: 'remoteHosts.state.offline' }
    case 'disconnected':
      return { tone: 'warn', pulse: false, labelKey: 'remoteHosts.state.disconnected' }
    case 'idle':
    default:
      return { tone: 'muted', pulse: false, labelKey: 'remoteHosts.state.idle' }
  }
}

const DOT_BG: Record<ConnectionDotSpec['tone'], string> = {
  success: 'bg-emerald-500',
  warn: 'bg-amber-500',
  muted: 'bg-muted-foreground/40',
  danger: 'bg-destructive',
}

function ConnectionDot({ state }: { state: ConnectionState }) {
  const { t } = useTranslation('settings')
  const spec = connectionDotSpec(state)
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="relative flex size-2 shrink-0 items-center justify-center" aria-hidden="true">
        {spec.pulse && (
          <span className={cn('absolute inline-flex size-2 animate-ping rounded-full opacity-60', DOT_BG[spec.tone])} />
        )}
        <span className={cn('relative inline-flex size-2 rounded-full', DOT_BG[spec.tone])} />
      </span>
      {t(spec.labelKey)}
    </span>
  )
}

function TransportBadge({ transport }: { transport: HostTransport }) {
  const { t } = useTranslation('settings')
  const labelKey: SettingsKey = transport === 'relay'
    ? 'remoteHosts.transport.relay'
    : transport === 'direct-socket'
      ? 'remoteHosts.transport.directSocket'
      : 'remoteHosts.transport.ssh'
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-4 px-1.5 text-[9px] font-normal',
        transport === 'relay'
          ? 'border-sky-500/30 text-sky-600 dark:text-sky-400'
          : 'border-border text-muted-foreground',
      )}
    >
      {t(labelKey)}
    </Badge>
  )
}

/** A friendly one-line summary of the daemon we're talking to. */
function daemonSummary(host: Host, health?: { daemonVersion?: string | null, daemonHostId?: string | null }): string | null {
  const agentd = readCapabilities(host).agentd
  const platform = agentd?.lastPlatform
  const version = health?.daemonVersion ?? agentd?.lastDaemonVersion
  const parts: string[] = []
  if (platform) {
    parts.push(platform)
  }
  if (version) {
    parts.push(`daemon v${version}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function CopyCodeButton({ command }: { command: string }) {
  const { t } = useTranslation('settings')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      toastManager.add({ type: 'success', title: t('remoteHosts.guide.commandCopied' as SettingsKey) })
      setTimeout(() => setCopied(false), 1500)
    }
    catch {
      toastManager.add({ type: 'error', title: t('remoteHosts.guide.copyFailed' as SettingsKey) })
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
        aria-label={t('remoteHosts.guide.copy' as SettingsKey)}
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
      {/* Connecting line between step badges */}
      {!isLast && (
        <span className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-border/70" aria-hidden="true" />
      )}
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

/**
 * The 3-step setup guide. Rendered as the empty state, and available on demand
 * (via a collapsible) once hosts exist.
 */
function SetupGuide({ onAdd }: { onAdd?: () => void }) {
  const { t } = useTranslation('settings')
  return (
    <div className="space-y-4">
      <ol className="space-y-0">
        <GuideStep
          index={1}
          title={t('remoteHosts.guide.step1.title' as SettingsKey)}
        >
          <p className="text-[12px] leading-relaxed text-muted-foreground/80">
            {t('remoteHosts.guide.step1.detail' as SettingsKey)}
          </p>
          <CopyCodeButton command="cradle-agentd" />
        </GuideStep>

        <GuideStep
          index={2}
          title={t('remoteHosts.guide.step2.title' as SettingsKey)}
        >
          <p className="text-[12px] leading-relaxed text-muted-foreground/80">
            {t('remoteHosts.guide.step2.detail' as SettingsKey)}
          </p>
          {onAdd && (
            <Button size="sm" onClick={onAdd}>
              <PlusIcon className="size-3.5" aria-hidden="true" />
              {t('remoteHosts.action.addHost' as SettingsKey)}
            </Button>
          )}
        </GuideStep>

        <GuideStep
          index={3}
          isLast
          title={t('remoteHosts.guide.step3.title' as SettingsKey)}
        >
          <p className="text-[12px] leading-relaxed text-muted-foreground/80">
            {t('remoteHosts.guide.step3.detail' as SettingsKey)}
          </p>
        </GuideStep>
      </ol>

      <p className="flex items-start gap-2 rounded-lg border border-sky-500/15 bg-sky-500/5 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        <RelayIcon className="mt-px size-3.5 shrink-0 text-sky-500" aria-hidden="true" />
        {t('remoteHosts.guide.relayNote' as SettingsKey)}
      </p>
    </div>
  )
}

/** Centered welcome empty state with the setup guide. */
function RemoteHostsEmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation('settings')
  return (
    <div className="flex flex-col items-center gap-7 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-foreground/5 text-foreground/70">
        <ServerIcon className="size-5" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          {t('remoteHosts.empty.title' as SettingsKey)}
        </h2>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {t('remoteHosts.guide.intro' as SettingsKey)}
        </p>
      </div>
      <div className="w-full max-w-md text-left">
        <SetupGuide onAdd={onAdd} />
      </div>
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

function formatTime(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) {
    return null
  }
  return new Date(ms).toLocaleString()
}

type FsEntry = GetRemoteHostsByHostIdAgentdFsDirectoryResponse['entries'][number]

function entryIcon(kind: FsEntry['kind']) {
  if (kind === 'directory' || kind === 'symlink') {
    return <FolderIcon className="size-3.5 shrink-0 text-sky-500/80" aria-hidden="true" />
  }
  return <FileIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
}

/**
 * Probes a selected remote path for filesystem metadata and git identity, then
 * surfaces a (pending) "register as remote project" action.
 *
 * Durable registration of a remote path as a Cradle-owned project is a separate
 * transport-aware schema step that isn't shipped yet — see the exec plan. Until
 * it lands, the action stays disabled with an explanatory note rather than
 * silently reusing the local-path `/workspaces` model.
 */
function RepositoryProbe({ host, path }: { host: Host, path: string }) {
  const { t } = useTranslation('settings')
  const hostOpts = { path: { hostId: host.id } }
  const statQuery = useQuery({
    ...getRemoteHostsByHostIdAgentdFsStatOptions({ ...hostOpts, query: { path } }),
    retry: false,
  })
  const gitQuery = useQuery({
    ...getRemoteHostsByHostIdAgentdGitRepositoryOptions({ ...hostOpts, query: { path } }),
    retry: false,
  })

  const stat: GetRemoteHostsByHostIdAgentdFsStatResponse | undefined = statQuery.data
  const git: GetRemoteHostsByHostIdAgentdGitRepositoryResponse | undefined = gitQuery.data
  const loading = statQuery.isLoading || gitQuery.isLoading

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-card/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {t('remoteHosts.directory.selected' as SettingsKey)}
          </p>
          <p className="truncate font-mono text-[11.5px] text-foreground/80">{path}</p>
        </div>
        {loading && <Spinner className="size-3.5" />}
      </div>

      {statQuery.isError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {describeError(statQuery.error)}
        </p>
      )}

      {stat && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal">{stat.kind}</Badge>
          {formatBytes(stat.size) && <span>{formatBytes(stat.size)}</span>}
          {formatTime(stat.modifiedAt) && (
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="size-3" aria-hidden="true" />
              {formatTime(stat.modifiedAt)}
            </span>
          )}
        </div>
      )}

      {gitQuery.isError && (
        <p className="text-[11px] text-muted-foreground/70">
          {t('remoteHosts.directory.probeUnavailable' as SettingsKey)}
        </p>
      )}

      {git && (
        git.isRepository
          ? (
              <div className="space-y-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-300">
                  <BranchIcon className="size-3.5" aria-hidden="true" />
                  {t('remoteHosts.directory.isRepo' as SettingsKey)}
                </div>
                <dl className="space-y-1 text-[11px]">
                  {git.rootPath && (
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-muted-foreground/70">{t('remoteHosts.directory.repoRoot' as SettingsKey)}</dt>
                      <dd className="min-w-0 break-all font-mono text-foreground/80">{git.rootPath}</dd>
                    </div>
                  )}
                  {git.branch && (
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-muted-foreground/70">{t('remoteHosts.directory.branch' as SettingsKey)}</dt>
                      <dd className="min-w-0 break-all font-mono text-foreground/80">{git.branch}</dd>
                    </div>
                  )}
                  {git.remoteUrl && (
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-muted-foreground/70">{t('remoteHosts.directory.remote' as SettingsKey)}</dt>
                      <dd className="min-w-0 break-all font-mono text-foreground/80">{git.remoteUrl}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )
          : (
              <p className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                {t('remoteHosts.directory.notRepo' as SettingsKey)}
              </p>
            )
      )}

      <p className="border-t border-border/60 pt-2.5 text-[10.5px] leading-relaxed text-muted-foreground/70">
        {t('remoteHosts.directory.addFromWorkspaceSidebar' as SettingsKey)}
      </p>
    </div>
  )
}

/**
 * Browse a connected host's filesystem, pick a project directory, and probe it
 * for git identity — the To-C project selection flow that replaces the old
 * `workspace/list` suggestions. No `CRADLE_AGENTD_WORKSPACE_ROOTS` needed: the
 * user navigates to wherever their code lives and selects it directly.
 */
function RemoteDirectoryBrowser({ host }: { host: Host }) {
  const { t } = useTranslation('settings')
  const [cwd, setCwd] = useState('~')
  const [pathInput, setPathInput] = useState('~')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const directoryQuery = useQuery({
    ...getRemoteHostsByHostIdAgentdFsDirectoryOptions({ path: { hostId: host.id }, query: { path: cwd } }),
    retry: false,
  })

  // Keep the editable path field in sync as the user navigates.
  useEffect(() => {
    setPathInput(cwd)
    // Navigating away clears the previous selection's probe panel.
    setSelectedPath(null)
  }, [cwd])

  const directory: GetRemoteHostsByHostIdAgentdFsDirectoryResponse | undefined = directoryQuery.data
  const entries = directory?.entries ?? []
  const directories = entries.filter(e => e.kind === 'directory' || e.kind === 'symlink')
  const files = entries.filter(e => e.kind !== 'directory' && e.kind !== 'symlink')
  const resolvedPath = directory?.path ?? cwd
  const parentPath = directory?.parentPath ?? null

  const goTo = (next: string) => {
    const trimmed = next.trim()
    if (trimmed && trimmed !== cwd) {
      setCwd(trimmed)
    }
  }

  return (
    <div className="space-y-2.5">
      {/* Path bar: jump-to input + up / home navigation */}
      <div className="flex items-center gap-1.5">
        <Input
          value={pathInput}
          onChange={e => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              goTo(pathInput)
            }
          }}
          placeholder={t('remoteHosts.directory.pathPlaceholder' as SettingsKey)}
          className="h-7 flex-1 font-mono text-[11.5px]"
        />
        <Button
          size="icon-xs"
          variant="outline"
          onClick={() => goTo(pathInput)}
          aria-label={t('remoteHosts.directory.go' as SettingsKey)}
        >
          <GoIcon className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={!parentPath}
          onClick={() => parentPath && goTo(parentPath)}
          aria-label={t('remoteHosts.directory.up' as SettingsKey)}
        >
          <UpIcon className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => goTo('~')}
          aria-label={t('remoteHosts.directory.home' as SettingsKey)}
        >
          <HomeIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {/* Resolved location + "use this directory" */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10.5px] text-muted-foreground/70" title={resolvedPath}>
          {resolvedPath}
        </span>
        <Button
          size="xs"
          variant="ghost"
          className="h-6 shrink-0 px-2 text-[10.5px]"
          disabled={directoryQuery.isLoading}
          onClick={() => setSelectedPath(resolvedPath)}
        >
          {t('remoteHosts.directory.useCurrent' as SettingsKey)}
        </Button>
      </div>

      {directoryQuery.isLoading
        ? <EmptyInline text={t('remoteHosts.detail.loading' as SettingsKey)} />
        : directoryQuery.isError
          ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                {describeError(directoryQuery.error)}
              </p>
            )
          : entries.length === 0
            ? <EmptyInline text={t('remoteHosts.directory.empty' as SettingsKey)} />
            : (
                <div className="max-h-64 overflow-y-auto rounded-md border border-border/60">
                  {[...directories, ...files].map(entry => (
                    <DirectoryEntryRow
                      key={entry.path}
                      entry={entry}
                      onNavigate={() => goTo(entry.path)}
                      onSelect={() => setSelectedPath(entry.path)}
                    />
                  ))}
                </div>
              )}

      {selectedPath && <RepositoryProbe host={host} path={selectedPath} />}
    </div>
  )
}

function DirectoryEntryRow({
  entry,
  onNavigate,
  onSelect,
}: {
  entry: FsEntry
  onNavigate: () => void
  onSelect: () => void
}) {
  const { t } = useTranslation('settings')
  const navigable = entry.kind === 'directory' || entry.kind === 'symlink'
  return (
    <div className="group flex items-center gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0 hover:bg-muted/40">
      <button
        type="button"
        disabled={!navigable}
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
      >
        {entryIcon(entry.kind)}
        <span className={cn('truncate text-[11.5px]', navigable ? 'text-foreground/85' : 'text-muted-foreground/70', entry.hidden && 'opacity-70')}>
          {entry.name}
        </span>
      </button>
      {navigable && (
        <Button
          size="xs"
          variant="ghost"
          className="h-5 shrink-0 px-1.5 text-[10px] opacity-0 group-hover:opacity-100"
          onClick={onSelect}
        >
          {t('remoteHosts.directory.select' as SettingsKey)}
        </Button>
      )}
    </div>
  )
}

/** Expanded detail panel for a connected host. */
function HostDetail({ host }: { host: Host }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const hostOpts = { path: { hostId: host.id } }
  const connected = host.connectionState === 'connected'

  const healthQuery = useQuery({
    ...getRemoteHostsByHostIdAgentdHealthOptions(hostOpts),
    enabled: connected,
    retry: false,
  })
  const runtimesQuery = useQuery({
    ...getRemoteHostsByHostIdAgentdRuntimesOptions(hostOpts),
    enabled: connected,
    retry: false,
  })
  const agentsQuery = useQuery({
    ...getRemoteHostsByHostIdAgentdAgentsOptions(hostOpts),
    enabled: connected,
    retry: false,
  })

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: getRemoteHostsByHostIdAgentdHealthQueryKey(hostOpts) })
    void queryClient.invalidateQueries({ queryKey: getRemoteHostsByHostIdAgentdRuntimesQueryKey(hostOpts) })
    void queryClient.invalidateQueries({ queryKey: getRemoteHostsByHostIdAgentdFsDirectoryQueryKey({ ...hostOpts, query: {} }) })
    void queryClient.invalidateQueries({ queryKey: getRemoteHostsByHostIdAgentdAgentsQueryKey(hostOpts) })
  }

  if (!connected) {
    return (
      <p className="text-[11.5px] text-muted-foreground/70">
        {t('remoteHosts.detail.connectToBrowse' as SettingsKey)}
      </p>
    )
  }

  const loadingAny = healthQuery.isLoading || runtimesQuery.isLoading || agentsQuery.isLoading
  const runtimes = runtimesQuery.data?.runtimes ?? []
  const agents = agentsQuery.data?.agents ?? []
  const summary = daemonSummary(host, healthQuery.data)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ConnectionDot state={host.connectionState} />
          {summary && <span className="text-[11px] text-muted-foreground/70">{summary}</span>}
        </div>
        <Button size="icon-xs" variant="ghost" onClick={refreshAll} aria-label={t('remoteHosts.action.refresh' as SettingsKey)}>
          <RefreshIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {host.lastError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          {host.lastError}
        </p>
      )}

      <DetailSection label={t('remoteHosts.detail.directory' as SettingsKey)}>
        <p className="text-[11px] leading-relaxed text-muted-foreground/70">
          {t('remoteHosts.directory.hint' as SettingsKey)}
        </p>
        <RemoteDirectoryBrowser host={host} />
      </DetailSection>

      <DetailSection label={t('remoteHosts.detail.runtimes' as SettingsKey)}>
        {loadingAny
          ? <EmptyInline text={t('remoteHosts.detail.loading' as SettingsKey)} />
          : runtimes.length === 0
            ? <EmptyInline text={t('remoteHosts.detail.noRuntimes' as SettingsKey)} />
            : (
                <div className="flex flex-col gap-1">
                  {runtimes.map(runtime => (
                    <div key={runtime.runtimeKind} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="font-mono text-foreground/80">{runtime.label || runtime.runtimeKind}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-4 px-1.5 text-[9px] font-normal',
                          runtime.status === 'available'
                            ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {t(`remoteHosts.runtime.${runtime.status}` as SettingsKey)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
      </DetailSection>

      <DetailSection label={t('remoteHosts.detail.agents' as SettingsKey)}>
        {loadingAny
          ? <EmptyInline text={t('remoteHosts.detail.loading' as SettingsKey)} />
          : agents.length === 0
            ? <EmptyInline text={t('remoteHosts.detail.noAgents' as SettingsKey)} />
            : (
                <div className="flex flex-col gap-1">
                  {agents.map(agent => (
                    <div key={agent.agentId} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-foreground/80">{agent.runtimeKind}</div>
                        <div className="truncate font-mono text-[10.5px] text-muted-foreground/60">{agent.workspacePath}</div>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-4 shrink-0 px-1.5 text-[9px] font-normal',
                          agent.status === 'running'
                            ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                            : agent.status === 'failed'
                              ? 'border-destructive/40 text-destructive'
                              : 'border-border text-muted-foreground',
                        )}
                      >
                        {t(`remoteHosts.agent.${agent.status}` as SettingsKey)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
      </DetailSection>
    </div>
  )
}

function HostRow({ host }: { host: Host }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [pairingRelay, setPairingRelay] = useState(false)

  const invalidateHosts = () => {
    void queryClient.invalidateQueries({ queryKey: getRemoteHostsQueryKey() })
  }

  const transport = hostTransport(host)
  const relay = readConnectionConfig(host)?.relay ?? null
  const isRelay = transport === 'relay'
  const roomShort = shortRoomId(relay?.lastSessionRoomId ?? null)

  const connect = useMutation({
    mutationFn: async () => {
      const { error } = await postRemoteHostsByHostIdAgentdConnect({ path: { hostId: host.id } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.connected' as SettingsKey) })
      invalidateHosts()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.connectFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  const disconnect = useMutation({
    mutationFn: async () => {
      const { error } = await postRemoteHostsByHostIdAgentdDisconnect({ path: { hostId: host.id } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.disconnected' as SettingsKey) })
      invalidateHosts()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.disconnectFailed' as SettingsKey),
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
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.deleted' as SettingsKey) })
      invalidateHosts()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.deleteFailed' as SettingsKey),
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
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.cradleServerOk' as SettingsKey) })
      invalidateHosts()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.cradleServerFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  const isConnected = host.connectionState === 'connected'
  const busy = connect.isPending || disconnect.isPending || deleteHost.isPending || testCradleServer.isPending

  return (
    <div data-testid={`remote-host-row-${host.id}`}>
      <div className="group flex items-center gap-3 px-3.5 py-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <ServerIcon className="size-3.5" aria-hidden="true" />
        </div>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[12.5px] font-medium text-foreground">{host.displayName}</span>
              <TransportBadge transport={transport} />
              {!host.enabled && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal text-muted-foreground">
                  {t('remoteHosts.badge.disabled' as SettingsKey)}
                </Badge>
              )}
              {isRelay && roomShort && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal text-muted-foreground" title={relay?.lastSessionRoomId}>
                  {t('remoteHosts.relay.roomLabel' as SettingsKey)} {roomShort}
                </Badge>
              )}
              <ConnectionDot state={host.connectionState} />
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground/70">
              {isRelay ? (relay?.relayUrl ?? t('remoteHosts.relay.noRoom' as SettingsKey)) : sshLabel(host)}
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
                  {t('remoteHosts.action.disconnect' as SettingsKey)}
                </Button>
              )
            : (
                <Button
                  size="xs"
                  variant="outline"
                  className="h-7 px-2.5 text-[11px]"
                  // A relay host that hasn't been paired yet has no relay
                  // coordinates — connecting would just 400. Nudge to pair.
                  disabled={busy || !host.enabled || (isRelay && !relay)}
                  onClick={() => connect.mutate()}
                >
                  {connect.isPending ? <Spinner className="size-3" /> : null}
                  {t('remoteHosts.action.connect' as SettingsKey)}
                </Button>
              )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setPairingRelay(true)}
                aria-label={t('remoteHosts.action.pairRelay' as SettingsKey)}
              >
                <RelayIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('remoteHosts.action.pairRelay' as SettingsKey)}</TooltipContent>
          </Tooltip>

          {!isRelay && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => testCradleServer.mutate()}
                  disabled={busy || !host.enabled}
                  aria-label={t('remoteHosts.action.testCradleServer' as SettingsKey)}
                >
                  {testCradleServer.isPending ? <Spinner className="size-3.5" /> : <ServerIcon className="size-3.5" aria-hidden="true" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('remoteHosts.action.testCradleServer' as SettingsKey)}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-xs" variant="ghost" onClick={() => setEditing(true)} aria-label={t('remoteHosts.action.edit' as SettingsKey)}>
                <PencilIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('remoteHosts.action.edit' as SettingsKey)}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                aria-label={t('remoteHosts.action.delete' as SettingsKey)}
              >
                {deleteHost.isPending ? <Spinner className="size-3.5" /> : <TrashIcon className="size-3.5" aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('remoteHosts.action.delete' as SettingsKey)}</TooltipContent>
          </Tooltip>

          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? t('remoteHosts.action.collapse' as SettingsKey) : t('remoteHosts.action.expand' as SettingsKey)}
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

      {editing && (
        <HostFormDialog
          open
          onOpenChange={open => !open && setEditing(false)}
          host={host}
        />
      )}

      <RelayPairingDialog
        open={pairingRelay}
        onOpenChange={open => setPairingRelay(open)}
        host={host}
      />

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('remoteHosts.delete.title' as SettingsKey)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('remoteHosts.delete.description', { name: host.displayName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('remoteHosts.action.cancel' as SettingsKey)}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteHost.mutate()
              }}
            >
              {t('remoteHosts.action.delete' as SettingsKey)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface HostFormValues {
  displayName: string
  transport: HostTransport
  remoteAddress: string
  username: string
  auth: 'default' | 'identityFile'
  identityFilePath: string
  remoteSocketPath: string
  enabled: boolean
}

/**
 * Pair a host through a relay server — the SSH-less path.
 *
 * Flow: enter/confirm the relay URL → generate a one-time `cradle-agentd relay`
 * command (with copy + expiry countdown) → run it on the remote machine, which
 * prints a pairing code → paste the code back here → POST /relay/claim. On
 * success the host's transport flips to relay and the row re-renders.
 */
function RelayPairingDialog({
  open,
  onOpenChange,
  host,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  host: Host
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const relayServersQuery = useQuery(getRelayServersOptions())
  const servers = relayServersQuery.data ?? []
  const defaultServer = servers.find(s => s.isDefault) ?? servers[0]

  // The selected relay server id. Defaults to the configured default server;
  // cleared only if there are no servers at all.
  const [relayServerId, setRelayServerId] = useState<string>('')
  const [pairing, setPairing] = useState<{ command: string, expiresAt: number } | null>(null)
  const [pairingCode, setPairingCode] = useState('')
  const [now, setNow] = useState(() => Date.now())

  // Re-seed the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setPairing(null)
      setPairingCode('')
      setNow(Date.now())
    }
  }, [open])

  // Default the selection once servers load (or when the default changes).
  useEffect(() => {
    if (defaultServer && !relayServerId) {
      setRelayServerId(defaultServer.id)
    }
  }, [defaultServer, relayServerId])

  // Tick once a second while a command is showing so the countdown stays live.
  useEffect(() => {
    if (!pairing) {
      return
    }
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [pairing])

  const remainingSec = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0
  const expired = !!pairing && remainingSec <= 0
  const hasServer = servers.length > 0

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await postRemoteHostsByHostIdRelayPairingToken({
        path: { hostId: host.id },
        body: { relayServerId },
      })
      if (error) {
        throw error
      }
      return data
    },
    onSuccess: (data) => {
      if (!data) {
        return
      }
      const command = [
        'cradle-agentd',
        'relay',
        'enroll',
        '--relay-url',
        quoteTerminalArg(data.relayUrl),
        '--pairing-token',
        quoteTerminalArg(data.pairingToken),
        '--host-token',
        quoteTerminalArg(data.hostToken),
        '--room-id',
        quoteTerminalArg(data.roomId),
        '--save-profile',
        '--profile',
        'default',
        '--server-url',
        quoteTerminalArg(window.location.origin),
        '--enrollment-id',
        quoteTerminalArg(data.enrollmentId),
        '--enrollment-secret',
        quoteTerminalArg(data.enrollmentSecret),
      ].join(' ')
      setPairing({ command, expiresAt: new Date(data.expiresAt).getTime() })
      setNow(Date.now())
      setPairingCode('')
      toastManager.add({ type: 'success', title: t('remoteHosts.relay.toast.commandGenerated' as SettingsKey) })
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.relay.toast.commandFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  const claim = useMutation({
    mutationFn: async () => {
      const { error } = await postRemoteHostsByHostIdRelayClaim({
        path: { hostId: host.id },
        // Send the relay server id so the server resolves the URL the same way
        // it did when minting the pairing token. (Claim is one-time on the
        // relay; the id must match the token's relay.)
        body: { relayServerId, pairingCode: pairingCode.trim() },
      })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.relay.toast.pairingComplete' as SettingsKey) })
      void queryClient.invalidateQueries({ queryKey: getRemoteHostsQueryKey() })
      onOpenChange(false)
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.relay.toast.pairingFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  const canGenerate = hasServer && !!relayServerId && !generate.isPending
  const canClaim = !!pairing && !expired && pairingCode.trim().length > 0 && !claim.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('remoteHosts.relay.dialog.title' as SettingsKey)}</DialogTitle>
          <DialogDescription>{t('remoteHosts.relay.dialog.description' as SettingsKey)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {hasServer
            ? (
                <div className="space-y-2">
                  <Label className="text-xs">{t('remoteHosts.relay.dialog.relayServer' as SettingsKey)}</Label>
                  <Select
                    value={relayServerId}
                    onValueChange={(next) => {
                      setRelayServerId(next)
                      // The pairing token is bound to one relay server. Switching
                      // invalidates any live command and pasted code.
                      if (pairing) {
                        setPairing(null)
                        setPairingCode('')
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {servers.map(server => (
                        <SelectItem key={server.id} value={server.id}>
                          {server.displayName}
                          {server.isDefault ? ` · ${t('remoteHosts.relayServers.badge.default' as SettingsKey)}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            : (
                <p className="rounded-lg border border-dashed border-foreground/10 bg-muted/20 px-3 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
                  {t('remoteHosts.relay.dialog.noRelayServerHint' as SettingsKey)}
                </p>
              )}

          <Button size="sm" disabled={!canGenerate} onClick={() => generate.mutate()} className="h-7 text-xs">
            {generate.isPending && <Spinner className="size-3.5" />}
            {pairing
              ? t('remoteHosts.relay.dialog.regenerate' as SettingsKey)
              : t('remoteHosts.relay.dialog.generate' as SettingsKey)}
          </Button>

          {pairing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">{t('remoteHosts.relay.dialog.commandTitle' as SettingsKey)}</Label>
                <span className={cn('text-[10.5px]', expired ? 'text-destructive' : 'text-muted-foreground')}>
                  {expired
                    ? t('remoteHosts.relay.dialog.expired' as SettingsKey)
                    : t('remoteHosts.relay.dialog.expiresIn', { seconds: remainingSec })}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">{t('remoteHosts.relay.dialog.commandHint' as SettingsKey)}</p>
              <CopyCodeButton command={pairing.command} />
            </div>
          )}

          {pairing && !expired && (
            <div className="space-y-2">
              <Label htmlFor="rh-pairing-code" className="text-xs">{t('remoteHosts.relay.dialog.pairingCode' as SettingsKey)}</Label>
              <Input
                id="rh-pairing-code"
                value={pairingCode}
                onChange={e => setPairingCode(e.target.value)}
                placeholder={t('remoteHosts.relay.dialog.pairingCodePlaceholder' as SettingsKey)}
                className="h-8 font-mono text-xs"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
            {t('remoteHosts.action.cancel' as SettingsKey)}
          </Button>
          <Button size="sm" disabled={!canClaim} onClick={() => claim.mutate()} className="h-7 text-xs">
            {claim.isPending && <Spinner className="size-3.5" />}
            {claim.isPending
              ? t('remoteHosts.relay.dialog.claiming' as SettingsKey)
              : t('remoteHosts.relay.dialog.claim' as SettingsKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function initialHostFormValues(host?: Host): HostFormValues {
  const config = host ? readConnectionConfig(host) : null
  const capabilities = host ? readCapabilities(host) : {}
  const ssh = config?.ssh
  return {
    displayName: host?.displayName ?? '',
    transport: host ? hostTransport(host) : 'ssh',
    remoteAddress: ssh?.hostName ?? '',
    username: ssh?.user ?? '',
    auth: ssh?.auth ?? 'default',
    identityFilePath: ssh?.identityFilePath ?? '',
    remoteSocketPath: capabilities.agentd?.remoteSocketPath ?? DEFAULT_REMOTE_SOCKET_PATH,
    enabled: host?.enabled ?? true,
  }
}

function HostFormDialog({
  open,
  onOpenChange,
  host,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  host?: Host
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [values, setValues] = useState<HostFormValues>(() => initialHostFormValues(host))
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Re-seed the form each time the dialog opens so the always-mounted "Add host"
  // dialog does not retain the previous submission's values.
  useEffect(() => {
    if (open) {
      setValues(initialHostFormValues(host))
      setAdvancedOpen(false)
    }
  }, [open, host])

  const set = (patch: Partial<HostFormValues>) => setValues(prev => ({ ...prev, ...patch }))

  const isRelay = values.transport === 'relay'
  // Relay hosts are created "pending" — no SSH target or socket path needed;
  // they're paired from the host row after saving. SSH hosts need both.
  const valid = values.displayName.trim().length > 0
    && (isRelay
      ? true
      : values.remoteAddress.trim().length > 0
        && values.username.trim().length > 0
        && values.remoteSocketPath.trim().length > 0
        && (values.auth === 'default' || values.identityFilePath.trim().length > 0))

  const save = useMutation({
    mutationFn: async () => {
      if (isRelay) {
        // Pending relay host: transport is relay, relay coordinates are filled
        // in later by the pairing flow.
        const body = {
          displayName: values.displayName.trim(),
          enabled: values.enabled,
          connectionConfig: { transport: 'relay' as const },
        }
        if (host) {
          const { error } = await patchRemoteHostsByHostId({ path: { hostId: host.id }, body })
          if (error) {
            throw error
          }
        }
        else {
          const { error } = await postRemoteHosts({ body })
          if (error) {
            throw error
          }
        }
        return
      }
      const body = {
        displayName: values.displayName.trim(),
        enabled: values.enabled,
        connectionConfig: {
          transport: 'ssh' as const,
          ssh: {
            hostName: values.remoteAddress.trim(),
            user: values.username.trim(),
            auth: values.auth,
            identityFilePath: values.auth === 'identityFile' ? values.identityFilePath.trim() : null,
          },
        },
        capabilities: {
          agentd: {
            remoteSocketPath: values.remoteSocketPath.trim(),
          },
          cradleServer: {
            enabled: true,
            remoteHost: '127.0.0.1',
            remotePort: 21_423,
          },
        },
      }
      if (host) {
        const { error } = await patchRemoteHostsByHostId({
          path: { hostId: host.id },
          body,
        })
        if (error) {
          throw error
        }
      }
      else {
        const { error } = await postRemoteHosts({
          body,
        })
        if (error) {
          throw error
        }
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t(host ? 'remoteHosts.toast.updated' as SettingsKey : 'remoteHosts.toast.created' as SettingsKey) })
      void queryClient.invalidateQueries({ queryKey: getRemoteHostsQueryKey() })
      onOpenChange(false)
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.saveFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(host ? 'remoteHosts.form.editTitle' as SettingsKey : 'remoteHosts.form.addTitle' as SettingsKey)}</DialogTitle>
          <DialogDescription>{t('remoteHosts.form.description' as SettingsKey)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="rh-display-name" className="text-xs">{t('remoteHosts.form.displayName' as SettingsKey)}</Label>
            <Input
              id="rh-display-name"
              value={values.displayName}
              onChange={e => set({ displayName: e.target.value })}
              placeholder={t('remoteHosts.form.displayNamePlaceholder' as SettingsKey)}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t('remoteHosts.form.transport' as SettingsKey)}</Label>
            <ToggleGroup
              type="single"
              value={values.transport}
              onValueChange={next => next && set({ transport: next as HostTransport })}
              className="w-full"
            >
              <ToggleGroupItem value="ssh" size="sm" className="flex-1 text-xs">
                {t('remoteHosts.form.transportSsh' as SettingsKey)}
              </ToggleGroupItem>
              <ToggleGroupItem value="relay" size="sm" className="flex-1 text-xs">
                {t('remoteHosts.form.transportRelay' as SettingsKey)}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {isRelay
            ? (
                <p className="flex items-start gap-2 rounded-lg border border-sky-500/15 bg-sky-500/5 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  <RelayIcon className="mt-px size-3.5 shrink-0 text-sky-500" aria-hidden="true" />
                  {t('remoteHosts.form.relayNote' as SettingsKey)}
                </p>
              )
            : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="rh-remote-address" className="text-xs">{t('remoteHosts.form.remoteAddress' as SettingsKey)}</Label>
                  <Input
                    id="rh-remote-address"
                    value={values.remoteAddress}
                    onChange={e => set({ remoteAddress: e.target.value })}
                    placeholder={t('remoteHosts.form.remoteAddressPlaceholder' as SettingsKey)}
                    className="h-8 font-mono text-xs"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rh-username" className="text-xs">{t('remoteHosts.form.username' as SettingsKey)}</Label>
                  <Input
                    id="rh-username"
                    value={values.username}
                    onChange={e => set({ username: e.target.value })}
                    placeholder={t('remoteHosts.form.usernamePlaceholder' as SettingsKey)}
                    className="h-8 font-mono text-xs"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">{t('remoteHosts.form.auth' as SettingsKey)}</Label>
                  <Select value={values.auth} onValueChange={next => set({ auth: next as HostFormValues['auth'] })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">{t('remoteHosts.form.authDefault' as SettingsKey)}</SelectItem>
                      <SelectItem value="identityFile">{t('remoteHosts.form.authIdentityFile' as SettingsKey)}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {values.auth === 'identityFile' && (
                  <div className="space-y-2">
                    <Label htmlFor="rh-identity-file" className="text-xs">{t('remoteHosts.form.identityFile' as SettingsKey)}</Label>
                    <Input
                      id="rh-identity-file"
                      value={values.identityFilePath}
                      onChange={e => set({ identityFilePath: e.target.value })}
                      placeholder={t('remoteHosts.form.identityFilePlaceholder' as SettingsKey)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                )}

                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ChevronIcon className={cn('size-3.5 transition-transform', advancedOpen ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
                      {t('remoteHosts.form.advanced' as SettingsKey)}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 pt-3">
                    <Label htmlFor="rh-socket-path" className="text-xs">{t('remoteHosts.form.remoteSocketPath' as SettingsKey)}</Label>
                    <Input
                      id="rh-socket-path"
                      value={values.remoteSocketPath}
                      onChange={e => set({ remoteSocketPath: e.target.value })}
                      placeholder={DEFAULT_REMOTE_SOCKET_PATH}
                      className="h-8 font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground">{t('remoteHosts.form.remoteSocketPathHint' as SettingsKey)}</p>
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-2.5">
            <div className="space-y-0.5">
              <Label className="text-xs">{t('remoteHosts.form.enabled' as SettingsKey)}</Label>
              <p className="text-[11px] text-muted-foreground">{t('remoteHosts.form.enabledHint' as SettingsKey)}</p>
            </div>
            <Switch checked={values.enabled} onCheckedChange={v => set({ enabled: v })} size="sm" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
            {t('remoteHosts.action.cancel' as SettingsKey)}
          </Button>
          <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()} className="h-7 text-xs">
            {save.isPending && <Spinner className="size-3.5" />}
            {t(host ? 'remoteHosts.action.save' as SettingsKey : 'remoteHosts.action.add' as SettingsKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface RelayServerFormValues {
  displayName: string
  relayUrl: string
  isDefault: boolean
}

function initialRelayServerFormValues(server?: RelayServer): RelayServerFormValues {
  return {
    displayName: server?.displayName ?? '',
    relayUrl: server?.relayUrl ?? '',
    isDefault: server?.isDefault ?? false,
  }
}

function RelayServerFormDialog({
  open,
  onOpenChange,
  server,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  server?: RelayServer
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [values, setValues] = useState<RelayServerFormValues>(() => initialRelayServerFormValues(server))

  useEffect(() => {
    if (open) {
      setValues(initialRelayServerFormValues(server))
    }
  }, [open, server])

  const set = (patch: Partial<RelayServerFormValues>) => setValues(prev => ({ ...prev, ...patch }))

  const valid = values.displayName.trim().length > 0 && values.relayUrl.trim().length > 0

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        displayName: values.displayName.trim(),
        relayUrl: values.relayUrl.trim(),
        isDefault: values.isDefault,
      }
      if (server) {
        const { error } = await patchRelayServersByRelayServerId({ path: { relayServerId: server.id }, body })
        if (error) {
          throw error
        }
      }
      else {
        const { error } = await postRelayServers({ body })
        if (error) {
          throw error
        }
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t(server ? 'remoteHosts.relayServers.toast.updated' as SettingsKey : 'remoteHosts.relayServers.toast.created' as SettingsKey) })
      void queryClient.invalidateQueries({ queryKey: getRelayServersQueryKey() })
      onOpenChange(false)
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.relayServers.toast.saveFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(server ? 'remoteHosts.relayServers.form.editTitle' as SettingsKey : 'remoteHosts.relayServers.form.addTitle' as SettingsKey)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="rs-display-name" className="text-xs">{t('remoteHosts.relayServers.form.displayName' as SettingsKey)}</Label>
            <Input
              id="rs-display-name"
              value={values.displayName}
              onChange={e => set({ displayName: e.target.value })}
              placeholder={t('remoteHosts.relayServers.form.displayNamePlaceholder' as SettingsKey)}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rs-relay-url" className="text-xs">{t('remoteHosts.relayServers.form.relayUrl' as SettingsKey)}</Label>
            <Input
              id="rs-relay-url"
              value={values.relayUrl}
              onChange={e => set({ relayUrl: e.target.value })}
              placeholder={t('remoteHosts.relayServers.form.relayUrlPlaceholder' as SettingsKey)}
              className="h-8 font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-2.5">
            <Label className="text-xs">{t('remoteHosts.relayServers.form.isDefault' as SettingsKey)}</Label>
            <Switch checked={values.isDefault} onCheckedChange={v => set({ isDefault: v })} size="sm" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
            {t('remoteHosts.action.cancel' as SettingsKey)}
          </Button>
          <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()} className="h-7 text-xs">
            {save.isPending && <Spinner className="size-3.5" />}
            {t(server ? 'remoteHosts.action.save' as SettingsKey : 'remoteHosts.action.add' as SettingsKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RelayServerRow({ server }: { server: RelayServer }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getRelayServersQueryKey() })
  }

  const setDefault = useMutation({
    mutationFn: async () => {
      const { error } = await patchRelayServersByRelayServerId({ path: { relayServerId: server.id }, body: { isDefault: true } })
      if (error) {
        throw error
      }
    },
    onSuccess: invalidate,
    onError: error => toastManager.add({ type: 'error', title: t('remoteHosts.relayServers.toast.saveFailed' as SettingsKey), description: describeError(error) }),
  })

  const deleteServer = useMutation({
    mutationFn: async () => {
      const { error } = await deleteRelayServersByRelayServerId({ path: { relayServerId: server.id } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.relayServers.toast.deleted' as SettingsKey) })
      invalidate()
    },
    onError: error => toastManager.add({ type: 'error', title: t('remoteHosts.relayServers.toast.deleteFailed' as SettingsKey), description: describeError(error) }),
  })

  return (
    <div data-testid={`relay-server-row-${server.id}`} className="flex items-center gap-3 px-3.5 py-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        <RelayIcon className="size-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-foreground">{server.displayName}</span>
          {server.isDefault && (
            <Badge variant="outline" className="h-4 border-sky-500/30 px-1.5 text-[9px] font-normal text-sky-600 dark:text-sky-400">
              {t('remoteHosts.relayServers.badge.default' as SettingsKey)}
            </Badge>
          )}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground/70">{server.relayUrl}</div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!server.isDefault && (
          <Button size="xs" variant="ghost" className="h-7 px-2.5 text-[11px]" disabled={setDefault.isPending} onClick={() => setDefault.mutate()}>
            {t('remoteHosts.relayServers.action.setDefault' as SettingsKey)}
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-xs" variant="ghost" onClick={() => setEditing(true)} aria-label={t('remoteHosts.relayServers.action.edit' as SettingsKey)}>
              <PencilIcon className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('remoteHosts.relayServers.action.edit' as SettingsKey)}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-xs" variant="ghost" onClick={() => setConfirmingDelete(true)} aria-label={t('remoteHosts.relayServers.action.delete' as SettingsKey)}>
              {deleteServer.isPending ? <Spinner className="size-3.5" /> : <TrashIcon className="size-3.5" aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('remoteHosts.relayServers.action.delete' as SettingsKey)}</TooltipContent>
        </Tooltip>
      </div>

      {editing && (
        <RelayServerFormDialog open onOpenChange={open => !open && setEditing(false)} server={server} />
      )}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('remoteHosts.relayServers.delete.title' as SettingsKey)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('remoteHosts.relayServers.delete.description', { name: server.displayName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('remoteHosts.action.cancel' as SettingsKey)}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteServer.mutate()}>
              {t('remoteHosts.relayServers.action.delete' as SettingsKey)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Relay server registry — the SSH-less path's equivalent of an SSH config entry.
 * Pairs of (name, URL) that remote hosts pair against instead of typing a URL
 * every time. Lives above the host list so it reads as a shared prerequisite.
 */
export function RelayServersSection() {
  const { t } = useTranslation('settings')
  const [addOpen, setAddOpen] = useState(false)
  const { data: servers = [], isLoading } = useQuery(getRelayServersOptions())

  return (
    <SettingsPage
      title={t('remoteHosts.relayServers.title' as SettingsKey)}
      description={t('remoteHosts.relayServers.description' as SettingsKey)}
      action={(
        <Button data-testid="add-relay-server-btn" size="sm" onClick={() => setAddOpen(true)}>
          <PlusIcon className="size-3.5" aria-hidden="true" />
          {t('remoteHosts.relayServers.add' as SettingsKey)}
        </Button>
      )}
      data-testid="relay-servers-section"
    >
      {isLoading
        ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-10 text-[12px] text-muted-foreground">
              <Spinner className="size-3.5" />
              {t('remoteHosts.loading' as SettingsKey)}
            </div>
          )
        : servers.length === 0
          ? (
              <p className="rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-6 py-8 text-center text-[12px] text-muted-foreground">
                {t('remoteHosts.relayServers.empty' as SettingsKey)}
              </p>
            )
          : (
              <SettingsGroup bare className="[&>*+*]:border-t [&>*+*]:border-border/60">
                {servers.map(server => (
                  <RelayServerRow key={server.id} server={server} />
                ))}
              </SettingsGroup>
            )}

      <RelayServerFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </SettingsPage>
  )
}

export function RemoteHostsSettings() {
  const { t } = useTranslation('settings')
  const [addOpen, setAddOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  const { data: hosts = [], isLoading } = useQuery(getRemoteHostsOptions())

  return (
    <>
      <RelayServersSection />

      <SettingsPage
        title={t('remoteHosts.page.title' as SettingsKey)}
        description={t('remoteHosts.page.description' as SettingsKey)}
        action={(
          <Button data-testid="add-remote-host-btn" size="sm" onClick={() => setAddOpen(true)}>
            <PlusIcon className="size-3.5" aria-hidden="true" />
            {t('remoteHosts.action.addHost' as SettingsKey)}
          </Button>
        )}
        className='mt-4'
        data-testid="remote-hosts-settings"
      >
      {isLoading
        ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-10 text-[12px] text-muted-foreground">
              <Spinner className="size-3.5" />
              {t('remoteHosts.loading' as SettingsKey)}
            </div>
          )
        : hosts.length === 0
          ? (
              <RemoteHostsEmptyState onAdd={() => setAddOpen(true)} />
            )
          : (
              <>
                <Collapsible open={guideOpen} onOpenChange={setGuideOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ChevronIcon className={cn('size-3.5 transition-transform', guideOpen ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
                      {t('remoteHosts.guide.toggle' as SettingsKey)}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4">
                    <div className="rounded-xl border border-border bg-card p-5">
                      <SetupGuide />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <SettingsGroup bare className="[&>*+*]:border-t [&>*+*]:border-border/60">
                  {hosts.map(host => (
                    <HostRow key={host.id} host={host} />
                  ))}
                </SettingsGroup>
              </>
            )}

      <HostFormDialog open={addOpen} onOpenChange={setAddOpen} />
      </SettingsPage>
    </>
  )
}
