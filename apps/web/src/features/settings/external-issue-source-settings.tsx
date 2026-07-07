import {
  ClockLine as ClockIcon,
  DeleteLine as Trash2Icon,
  More2Line as MoreHorizontalIcon,
  Plugin2Line as PlugZapIcon,
  PowerLine as PowerIcon,
  Refresh1Line as RefreshCwIcon,
} from '@mingcute/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deleteExternalIssueSourcesBindingsByBindingId,
  getExternalIssueSources,
  getExternalIssueSourcesBindings,
  getExternalIssueSourcesItems,
  patchExternalIssueSourcesBindingsByBindingId,
  postExternalIssueSourcesBindingsByBindingIdRefresh,
  postExternalIssueSourcesBySourceKeyBindings,
} from '~/api-gen/sdk.gen'
import type { GetExternalIssueSourcesBindingsResponse, GetExternalIssueSourcesItemsResponse, GetExternalIssueSourcesResponse } from '~/api-gen/types.gen'
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
import { Checkbox } from '~/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

import { SettingsPage } from './settings-container'

type Source = GetExternalIssueSourcesResponse[number]
type Binding = GetExternalIssueSourcesBindingsResponse[number]
type ExternalItem = GetExternalIssueSourcesItemsResponse[number]

const DEFAULT_REFRESH_INTERVAL_SECONDS = 3600

const queryKeys = {
  sources: ['external-issue-sources', 'sources'] as const,
  bindings: (workspaceId: string) => ['external-issue-sources', 'bindings', workspaceId] as const,
  items: (workspaceId: string) => ['external-issue-sources', 'items', workspaceId] as const,
}

// ── Pure helpers ────────────────────────────────────────────────────────────

type DotTone = 'success' | 'warning' | 'error' | 'idle' | 'paused'

const DOT_BG: Record<Exclude<DotTone, 'paused'>, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-destructive',
  idle: 'bg-muted-foreground/40',
}

/** Accepts `owner/repo`, a full URL, or a `host/owner/repo` path — source-agnostic. */
function parseRepository(raw: string): { owner: string, name: string } | null {
  let value = raw.trim()
  if (!value) {
    return null
  }
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // drop scheme
  if (/^[^/\s]+\.[^/\s]+\//.test(value)) {
    value = value.replace(/^[^/]+\//, '') // drop host segment (contains a dot)
  }
  const parts = value.split('/').filter(Boolean)
  if (parts.length < 2) {
    return null
  }
  const owner = parts[0]
  const name = parts[1].replace(/\.git$/i, '')
  return owner && name ? { owner, name } : null
}

function timeAgo(seconds: number | null): string | null {
  if (!seconds) {
    return null
  }
  const diff = Math.floor(Date.now() / 1000) - seconds
  if (diff < 60) {
    return 'just now'
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m ago`
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h ago`
  }
  if (diff < 2592000) {
    return `${Math.floor(diff / 86400)}d ago`
  }
  return `${Math.floor(diff / 2592000)}mo ago`
}

function timeUntil(seconds: number | null): string | null {
  if (!seconds) {
    return null
  }
  const diff = seconds - Math.floor(Date.now() / 1000)
  if (diff <= 0) {
    return 'soon'
  }
  if (diff < 3600) {
    return `in ${Math.max(1, Math.floor(diff / 60))}m`
  }
  if (diff < 86400) {
    return `in ${Math.floor(diff / 3600)}h`
  }
  return `in ${Math.floor(diff / 86400)}d`
}

function absoluteTime(seconds: number | null): string | undefined {
  return seconds ? new Date(seconds * 1000).toLocaleString() : undefined
}

function isSourceAvailable(source: Source): boolean {
  return source.registrationStatus === 'registered' && source.enabled
}

function statusDot(binding: Binding, refreshing: boolean): { tone: DotTone, pulse: boolean } {
  if (refreshing) {
    return { tone: 'success', pulse: true }
  }
  if (!binding.enabled) {
    return { tone: 'paused', pulse: false }
  }
  switch (binding.lastRefreshStatus) {
    case 'error':
      return { tone: 'error', pulse: false }
    case 'rate-limited':
    case 'warning':
      return { tone: 'warning', pulse: false }
    case 'ok':
    case 'not-modified':
      return { tone: 'success', pulse: false }
    default:
      return { tone: 'idle', pulse: false }
  }
}

function itemCountForBinding(items: ExternalItem[], bindingId: string): number {
  return items.filter(item => item.bindingId === bindingId && item.syncStatus === 'active').length
}

function withId(prev: Set<string>, id: string, on: boolean): Set<string> {
  const next = new Set(prev)
  if (on) {
    next.add(id)
  }
  else {
    next.delete(id)
  }
  return next
}

function apiErrorMessage(error: unknown): string | null {
  if (!error) {
    return null
  }
  if (error instanceof Error) {
    return error.message || null
  }
  if (typeof error === 'string') {
    return error
  }
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error
    }
    const nested = apiErrorMessage(record.error)
    if (nested) {
      return nested
    }
  }
  return String(error)
}

// ── Page ──────────────────────────────────────────────────────────────────

export function ExternalIssueSourceSettings() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const { workspaces, ready } = useWorkspaces()

  const [workspaceId, setWorkspaceId] = useState('')
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(() => new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [connectingSource, setConnectingSource] = useState<string | null>(null)

  const activeWorkspaceId = workspaceId || workspaces[0]?.id || ''

  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: async () => {
      const { data, error } = await getExternalIssueSources()
      if (error) {
        throw new Error(String(error))
      }
      return (data ?? []) as Source[]
    },
  })

  const bindingsQuery = useQuery({
    queryKey: queryKeys.bindings(activeWorkspaceId),
    queryFn: async () => {
      const { data, error } = await getExternalIssueSourcesBindings({ query: { workspaceId: activeWorkspaceId } })
      if (error) {
        throw new Error(String(error))
      }
      return (data ?? []) as Binding[]
    },
    enabled: !!activeWorkspaceId,
  })

  const itemsQuery = useQuery({
    queryKey: queryKeys.items(activeWorkspaceId),
    queryFn: async () => {
      const { data, error } = await getExternalIssueSourcesItems({ query: { workspaceId: activeWorkspaceId } })
      if (error) {
        throw new Error(String(error))
      }
      return (data ?? []) as ExternalItem[]
    },
    enabled: !!activeWorkspaceId,
  })

  const sources = useMemo(() => sourcesQuery.data ?? [], [sourcesQuery.data])
  const bindings = useMemo(() => bindingsQuery.data ?? [], [bindingsQuery.data])
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data])

  const orderedSources = useMemo(
    () =>
      [...sources].sort((a, b) => {
        const rank = (s: Source) => (isSourceAvailable(s) ? 0 : 1)
        return rank(a) - rank(b) || a.label.localeCompare(b.label)
      }),
    [sources],
  )

  const bindingsBySource = useMemo(() => {
    const map = new Map<string, Binding[]>()
    for (const binding of bindings) {
      const list = map.get(binding.sourceKey) ?? []
      list.push(binding)
      map.set(binding.sourceKey, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => `${a.repositoryOwner}/${a.repositoryName}`.localeCompare(`${b.repositoryOwner}/${b.repositoryName}`))
    }
    return map
  }, [bindings])

  const connectedCount = useMemo(() => bindings.filter(b => b.enabled).length, [bindings])
  const errorBindings = useMemo(() => bindings.filter(b => b.enabled && b.lastRefreshStatus === 'error'), [bindings])
  const errorCount = errorBindings.length
  const loading = sourcesQuery.isPending || bindingsQuery.isPending || itemsQuery.isPending

  const invalidateWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.bindings(activeWorkspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.items(activeWorkspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sources }),
      queryClient.invalidateQueries({ queryKey: ['kanban', 'externalIssues', activeWorkspaceId] }),
    ])
  }

  const handleConnect = async (sourceId: string, rawRepository: string, refreshNow: boolean): Promise<boolean> => {
    const parsed = parseRepository(rawRepository)
    if (!parsed || !activeWorkspaceId) {
      toastManager.add({ type: 'error', title: t('externalIssues.toast.invalidRepo') })
      return false
    }
    setConnectingSource(sourceId)
    try {
      const { data, error } = await postExternalIssueSourcesBySourceKeyBindings({
        path: { sourceKey: sourceId },
        body: {
          workspaceId: activeWorkspaceId,
          repositoryOwner: parsed.owner,
          repositoryName: parsed.name,
          refreshIntervalSeconds: DEFAULT_REFRESH_INTERVAL_SECONDS,
          refreshNow,
        },
      })
      if (error || !data) {
        throw new Error(apiErrorMessage(error) ?? 'connect failed')
      }
      toastManager.add({ type: 'success', title: t('externalIssues.toast.connected', { repo: `${data.repositoryOwner}/${data.repositoryName}` }) })
      await invalidateWorkspace()
      return true
    }
    catch (error) {
      toastManager.add({ type: 'error', title: t('externalIssues.toast.connectFailed'), description: apiErrorMessage(error) ?? rawRepository })
      await invalidateWorkspace()
      return false
    }
    finally {
      setConnectingSource(null)
    }
  }

  const handleRefresh = async (binding: Binding) => {
    const repo = `${binding.repositoryOwner}/${binding.repositoryName}`
    setRefreshingIds(prev => withId(prev, binding.id, true))
    try {
      const { data, error } = await postExternalIssueSourcesBindingsByBindingIdRefresh({
        path: { bindingId: binding.id },
        body: { force: false },
      })
      if (error || !data) {
        throw new Error(apiErrorMessage(error) ?? 'refresh failed')
      }
      toastManager.add({
        type: data.status === 'error' || data.status === 'rate-limited' ? 'warning' : 'success',
        title: repo,
        description: t('externalIssues.toast.refreshed', { status: data.status, n: data.recordsProjected }),
      })
      await invalidateWorkspace()
    }
    catch (error) {
      toastManager.add({ type: 'error', title: t('externalIssues.toast.refreshFailed'), description: `${repo}: ${apiErrorMessage(error) ?? ''}`.trim() })
      await invalidateWorkspace()
    }
    finally {
      setRefreshingIds(prev => withId(prev, binding.id, false))
    }
  }

  const handleUpdate = async (binding: Binding, patch: { enabled?: boolean, scheduleEnabled?: boolean }) => {
    setBusyIds(prev => withId(prev, binding.id, true))
    try {
      const { error } = await patchExternalIssueSourcesBindingsByBindingId({ path: { bindingId: binding.id }, body: patch })
      if (error) {
        throw new Error('update failed')
      }
      await invalidateWorkspace()
    }
    catch {
      toastManager.add({ type: 'error', title: t('externalIssues.toast.updateFailed') })
    }
    finally {
      setBusyIds(prev => withId(prev, binding.id, false))
    }
  }

  const handleDisconnect = async (binding: Binding) => {
    const repo = `${binding.repositoryOwner}/${binding.repositoryName}`
    setBusyIds(prev => withId(prev, binding.id, true))
    try {
      const { error } = await deleteExternalIssueSourcesBindingsByBindingId({ path: { bindingId: binding.id } })
      if (error) {
        throw new Error('disconnect failed')
      }
      toastManager.add({ type: 'success', title: t('externalIssues.toast.disconnected', { repo }) })
      await invalidateWorkspace()
    }
    catch {
      toastManager.add({ type: 'error', title: t('externalIssues.toast.updateFailed') })
    }
    finally {
      setBusyIds(prev => withId(prev, binding.id, false))
    }
  }

  if (!ready) {
    return null
  }

  const statusBadge = connectedCount > 0
    ? (
        <span className="flex items-center gap-1.5 text-[11.5px] tabular-nums text-foreground/80">
          <StatusDot tone="success" />
          {t('externalIssues.status.connected', { n: connectedCount })}
          {errorCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default text-destructive underline decoration-dotted underline-offset-2">
                  {' · '}
                  {t('externalIssues.status.error', { n: errorCount })}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs space-y-1 text-xs">
                {errorBindings.map(b => (
                  <div key={b.id}>
                    <span className="font-medium">
{b.repositoryOwner}
/
{b.repositoryName}
                    </span>
                    {b.lastRefreshError && (
                      <span className="block text-muted-foreground">{b.lastRefreshError}</span>
                    )}
                  </div>
                ))}
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      )
    : (
        <span className="flex items-center gap-1.5 text-[11.5px] tabular-nums text-muted-foreground">
          <StatusDot tone="idle" />
          {t('externalIssues.status.none')}
        </span>
      )

  return (
    <SettingsPage
      title={t('externalIssues.page.title')}
      description={t('externalIssues.page.description')}
      action={statusBadge}
    >
      {/* Workspace context */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        <span className="text-[12px] text-muted-foreground">{t('externalIssues.workspace.label')}</span>
        <Select value={activeWorkspaceId} onValueChange={setWorkspaceId}>
          <SelectTrigger size="sm" className="w-56 text-[12.5px]">
            <SelectValue placeholder={t('externalIssues.workspace.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map(workspace => (
              <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sources */}
      <div className="flex flex-col gap-3">
        {loading && orderedSources.length === 0
          ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-border/60 py-10 text-[12px] text-muted-foreground">
                <Spinner className="size-3.5" />
              </div>
            )
          : orderedSources.length === 0
            ? (
                <div className="rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-4 py-8 text-center text-[12px] text-muted-foreground/70">
                  {t('externalIssues.source.empty')}
                </div>
              )
            : (
                orderedSources.map(source => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    bindings={bindingsBySource.get(source.id) ?? []}
                    items={items}
                    connecting={connectingSource === source.id}
                    refreshingIds={refreshingIds}
                    busyIds={busyIds}
                    onConnect={(repo, refreshNow) => handleConnect(source.id, repo, refreshNow)}
                    onRefresh={handleRefresh}
                    onToggleEnabled={(binding, enabled) => handleUpdate(binding, { enabled })}
                    onToggleSchedule={(binding, scheduleEnabled) => handleUpdate(binding, { scheduleEnabled })}
                    onDisconnect={handleDisconnect}
                  />
                ))
              )}
      </div>
    </SettingsPage>
  )
}

// ── Source card ─────────────────────────────────────────────────────────────

function SourceCard({
  source,
  bindings,
  items,
  connecting,
  refreshingIds,
  busyIds,
  onConnect,
  onRefresh,
  onToggleEnabled,
  onToggleSchedule,
  onDisconnect,
}: {
  source: Source
  bindings: Binding[]
  items: ExternalItem[]
  connecting: boolean
  refreshingIds: Set<string>
  busyIds: Set<string>
  onConnect: (repository: string, refreshNow: boolean) => Promise<boolean>
  onRefresh: (binding: Binding) => void
  onToggleEnabled: (binding: Binding, enabled: boolean) => void
  onToggleSchedule: (binding: Binding, scheduleEnabled: boolean) => void
  onDisconnect: (binding: Binding) => void
}) {
  const { t } = useTranslation('settings')
  const available = isSourceAvailable(source)
  const connectedCount = bindings.filter(b => b.enabled).length

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      {/* Header */}
      <div className="flex items-center gap-3 px-3.5 py-3">
        <SourceMark label={source.label} muted={!available} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-[13px] font-medium', available ? 'text-foreground' : 'text-muted-foreground')}>
              {source.label}
            </span>
            {!available && <Badge variant="outline" className="text-muted-foreground">{t('externalIssues.source.unavailable')}</Badge>}
          </div>
          {source.description && (
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{source.description}</p>
          )}
        </div>
        <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
          {available
            ? connectedCount > 0
              ? t('externalIssues.source.connectedCount', { n: connectedCount })
              : t('externalIssues.source.notConnected')
            : null}
        </span>
      </div>

      {available
        ? (
            <>
              <ConnectComposer connecting={connecting} onConnect={onConnect} />
              {bindings.length > 0
                ? (
                    <ul className="border-t border-border/60">
                      {bindings.map(binding => (
                        <RepositoryRow
                          key={binding.id}
                          binding={binding}
                          itemCount={itemCountForBinding(items, binding.id)}
                          refreshing={refreshingIds.has(binding.id)}
                          busy={busyIds.has(binding.id) || refreshingIds.has(binding.id)}
                          onRefresh={() => onRefresh(binding)}
                          onToggleEnabled={enabled => onToggleEnabled(binding, enabled)}
                          onToggleSchedule={scheduleEnabled => onToggleSchedule(binding, scheduleEnabled)}
                          onDisconnect={() => onDisconnect(binding)}
                        />
                      ))}
                    </ul>
                  )
                : (
                    <div className="border-t border-border/60 px-3.5 py-5 text-center text-[12px] text-muted-foreground/70">
                      {t('externalIssues.repo.empty')}
                    </div>
                  )}
            </>
          )
        : (
            <div className="flex items-center gap-2 border-t border-border/60 px-3.5 py-4 text-[12px] text-muted-foreground/80">
              <PlugZapIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden="true" />
              {t('externalIssues.source.unavailableHint')}
            </div>
          )}
    </section>
  )
}

// ── Connect composer ────────────────────────────────────────────────────────

function ConnectComposer({
  connecting,
  onConnect,
}: {
  connecting: boolean
  onConnect: (repository: string, refreshNow: boolean) => Promise<boolean>
}) {
  const { t } = useTranslation('settings')
  const [repository, setRepository] = useState('')
  const [refreshNow, setRefreshNow] = useState(true)

  const parsed = parseRepository(repository)
  const invalid = repository.trim().length > 0 && !parsed

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        const ok = await onConnect(repository, refreshNow)
        if (ok) {
          setRepository('')
        }
      }}
      className="flex flex-col gap-2 border-t border-border/60 px-3.5 py-3"
    >
      <div className="flex items-center gap-2">
        <Input
          value={repository}
          onChange={event => setRepository(event.target.value)}
          placeholder={t('externalIssues.connect.placeholder')}
          aria-invalid={invalid}
          className="h-8 flex-1 text-[12.5px]"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button type="submit" size="sm" disabled={connecting || !parsed}>
          {connecting && <Spinner className="size-3.5" aria-hidden="true" />}
          {t('externalIssues.connect.action')}
        </Button>
      </div>
      <label className="flex w-fit items-center gap-2 text-[11.5px] text-muted-foreground">
        <Checkbox checked={refreshNow} onCheckedChange={value => setRefreshNow(value === true)} />
        {t('externalIssues.connect.refreshNow')}
      </label>
    </form>
  )
}

// ── Repository row ──────────────────────────────────────────────────────────

function RepositoryRow({
  binding,
  itemCount,
  refreshing,
  busy,
  onRefresh,
  onToggleEnabled,
  onToggleSchedule,
  onDisconnect,
}: {
  binding: Binding
  itemCount: number
  refreshing: boolean
  busy: boolean
  onRefresh: () => void
  onToggleEnabled: (enabled: boolean) => void
  onToggleSchedule: (scheduleEnabled: boolean) => void
  onDisconnect: () => void
}) {
  const { t } = useTranslation('settings')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const repo = `${binding.repositoryOwner}/${binding.repositoryName}`
  const dot = statusDot(binding, refreshing)
  const meta = describeMeta()

  function describeMeta(): { text: string, tone: 'muted' | 'warning' | 'error' } {
    if (refreshing) {
      return { text: t('externalIssues.repo.syncing'), tone: 'muted' }
    }
    if (!binding.enabled) {
      return { text: t('externalIssues.repo.paused', { n: itemCount }), tone: 'muted' }
    }
    if (binding.lastRefreshStatus === 'error') {
      return {
        text: binding.lastRefreshError ?? binding.lastRefreshMessage ?? t('externalIssues.repo.errorFallback'),
        tone: 'error',
      }
    }
    if (binding.lastRefreshStatus === 'rate-limited') {
      return {
        text: binding.lastRefreshError ?? binding.lastRefreshMessage ?? t('externalIssues.repo.rateLimited', { time: timeUntil(binding.nextRefreshAfter) ?? 'soon' }),
        tone: 'warning',
      }
    }
    const ago = timeAgo(binding.lastRefreshAt)
    return ago
      ? { text: t('externalIssues.repo.meta', { n: itemCount, time: ago }), tone: 'muted' }
      : { text: t('externalIssues.repo.metaNever', { n: itemCount }), tone: 'muted' }
  }

  return (
    <li className="group flex items-center gap-3 border-b border-border/40 px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-muted/30">
      <StatusDot tone={dot.tone} pulse={dot.pulse} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium text-foreground">{repo}</span>
          {binding.scheduleEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <ClockIcon className="size-3 shrink-0 !text-muted-foreground/60" aria-label={t('externalIssues.menu.autoRefresh')} />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">{t('externalIssues.menu.autoRefresh')}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {meta.tone === 'error'
          ? (
              <div className="mt-1 rounded-md border border-destructive/25 bg-destructive/5 px-2 py-1.5">
                <p className="line-clamp-3 break-words text-[11.5px] leading-4 text-destructive">
                  {meta.text}
                </p>
              </div>
            )
          : (
              <p
                className={cn(
                  'mt-0.5 truncate text-[11.5px] tabular-nums',
                  meta.tone === 'warning' ? 'text-warning' : 'text-muted-foreground',
                )}
                title={absoluteTime(binding.lastRefreshAt) ?? undefined}
              >
                {meta.text}
              </p>
            )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onClick={onRefresh}
        aria-label={t('externalIssues.menu.refresh')}
        className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
      >
        <RefreshCwIcon className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={t('externalIssues.menu.more', { repo })}>
            <MoreHorizontalIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onRefresh} disabled={busy}>
            <RefreshCwIcon aria-hidden="true" />
            {t('externalIssues.menu.refresh')}
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            checked={binding.scheduleEnabled}
            onCheckedChange={checked => onToggleSchedule(checked === true)}
          >
            {t('externalIssues.menu.autoRefresh')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem onSelect={() => onToggleEnabled(!binding.enabled)}>
            <PowerIcon aria-hidden="true" />
            {binding.enabled ? t('externalIssues.menu.disable') : t('externalIssues.menu.enable')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault()
              setConfirmOpen(true)
            }}
          >
            <Trash2Icon aria-hidden="true" />
            {t('externalIssues.menu.disconnect')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('externalIssues.disconnect.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('externalIssues.disconnect.description', { repo })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('externalIssues.disconnect.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDisconnect}>
              {t('externalIssues.disconnect.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

// ── Bits ────────────────────────────────────────────────────────────────────

function StatusDot({ tone, pulse }: { tone: DotTone, pulse?: boolean }) {
  return (
    <span className="relative flex size-2 shrink-0 items-center justify-center" aria-hidden="true">
      {pulse && tone !== 'paused' && (
        <span className={cn('absolute inline-flex size-2 animate-ping rounded-full opacity-60', DOT_BG[tone])} />
      )}
      <span
        className={cn(
          'relative inline-flex size-2 rounded-full',
          tone === 'paused' ? 'border border-muted-foreground/50' : DOT_BG[tone],
        )}
      />
    </span>
  )
}

/**
 * Placeholder identity mark: a monogram derived from the source label.
 * Brand marks will be provided later — swap this for a per-source icon lookup.
 */
function SourceMark({ label, muted }: { label: string, muted?: boolean }) {
  const letter = (label.trim()[0] ?? '?').toUpperCase()
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-[13px] font-semibold select-none',
        muted ? 'bg-muted/50 text-muted-foreground' : 'bg-muted text-foreground/80',
      )}
      aria-hidden="true"
    >
      {letter}
    </div>
  )
}
