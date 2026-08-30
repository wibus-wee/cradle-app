import {
  AttachmentLine as AttachmentIcon,
  BroomLine as ClearIcon,
  BugLine as DiagnosticsIcon,
  CylinderLine as DatabaseIcon,
  Delete2Line as DeleteIcon,
  DriveLine as DriveIcon,
  EraserLine as EraserIcon,
  FileCodeLine as ArtifactIcon,
  More3Line as OtherIcon,
  Refresh1Line as RefreshIcon,
  SearchLine as SearchIcon,
  TerminalBoxLine as TerminalIcon,
} from '@mingcute/react'
import { useEffect, useMemo, useState } from 'react'

import type { GetStorageOverviewResponse } from '~/api-gen/types.gen'
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
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

export type StorageManagerAction = 'purge-transcripts' | 'delete-sessions'
type StorageSession = GetStorageOverviewResponse['sessions'][number]
type StorageCategory = GetStorageOverviewResponse['categories'][number]

export interface StorageManagerCopy {
  title: string
  description: string
  totalUsed: string
  measuredNow: string
  refresh: string
  categories: Record<StorageCategory['id'], string>
  categoryFiles: (count: number) => string
  sessionsTitle: string
  sessionsCount: (count: number) => string
  searchPlaceholder: string
  largestFirst: string
  recentFirst: string
  selectAll: string
  clearTranscript: string
  deleteSession: string
  selected: (count: number) => string
  clearSelected: string
  deleteSelected: string
  empty: string
  noMatches: string
  error: string
  active: string
  archived: string
  messages: (count: number) => string
  localData: string
  runtimeData: string
  attachments: string
  artifacts: string
  terminal: string
  confirmClearTitle: (count: number) => string
  confirmClearDescription: string
  confirmDeleteTitle: (count: number) => string
  confirmDeleteDescription: string
  cancel: string
  confirmClear: string
  confirmDelete: string
}

interface StorageManagerViewProps {
  overview: GetStorageOverviewResponse | null
  copy: StorageManagerCopy
  loading: boolean
  error: boolean
  busy: boolean
  onRefresh: () => void
  onAction: (action: StorageManagerAction, sessionIds: string[]) => void
}

const categoryVisuals = {
  database: { icon: DatabaseIcon, bar: 'bg-chart-1' },
  runtime: { icon: DriveIcon, bar: 'bg-chart-2' },
  attachments: { icon: AttachmentIcon, bar: 'bg-chart-3' },
  artifacts: { icon: ArtifactIcon, bar: 'bg-chart-4' },
  terminal: { icon: TerminalIcon, bar: 'bg-info' },
  diagnostics: { icon: DiagnosticsIcon, bar: 'bg-chart-5' },
  other: { icon: OtherIcon, bar: 'bg-muted-foreground' },
} satisfies Record<StorageCategory['id'], { icon: typeof DatabaseIcon, bar: string }>

export function StorageManagerView({
  overview,
  copy,
  loading,
  error,
  busy,
  onRefresh,
  onAction,
}: StorageManagerViewProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'size' | 'recent'>('size')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirmation, setConfirmation] = useState<{
    action: StorageManagerAction
    sessionIds: string[]
  } | null>(null)

  useEffect(() => {
    const selectable = new Set(overview?.sessions
      .filter(session => !session.active)
      .map(session => session.id) ?? [])
    setSelected(current => new Set([...current].filter(id => selectable.has(id))))
  }, [overview])

  const sessions = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const filtered = (overview?.sessions ?? []).filter(session => !normalized
      || session.title.toLowerCase().includes(normalized)
      || session.workspaceName?.toLowerCase().includes(normalized)
      || session.runtimeKind.toLowerCase().includes(normalized))
    return filtered.toSorted((left, right) => sort === 'size'
      ? right.reclaimableBytes - left.reclaimableBytes
      : right.updatedAt - left.updatedAt)
  }, [overview, query, sort])

  const selectableSessions = sessions.filter(session => !session.active)
  const allVisibleSelected = selectableSessions.length > 0
    && selectableSessions.every(session => selected.has(session.id))

  const requestAction = (action: StorageManagerAction, sessionIds: string[]) => {
    if (sessionIds.length > 0) {
      setConfirmation({ action, sessionIds })
    }
  }

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col" data-testid="storage-manager">
        <header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-tight text-foreground text-balance">{copy.title}</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground text-pretty">{copy.description}</p>
          </div>
          <Tooltip>
            <TooltipTrigger render={(
              <Button
                variant="outline"
                size="icon"
                onClick={onRefresh}
                disabled={loading || busy}
                aria-label={copy.refresh}
              >
                <RefreshIcon className={cn('size-4', loading && 'animate-spin')} />
              </Button>
            )}
            />
            <TooltipContent>{copy.refresh}</TooltipContent>
          </Tooltip>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <StorageSummary overview={overview} copy={copy} loading={loading} error={error} />

            <section className="overflow-hidden rounded-lg bg-card shadow-[var(--shadow-sm)]">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <h2 className="text-[13px] font-medium text-foreground">{copy.sessionsTitle}</h2>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {copy.sessionsCount(overview?.sessions.length ?? 0)}
                  </span>
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5" role="group">
                  <Button
                    variant={sort === 'size' ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() => setSort('size')}
                  >
                    {copy.largestFirst}
                  </Button>
                  <Button
                    variant={sort === 'recent' ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() => setSort('recent')}
                  >
                    {copy.recentFirst}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 bg-muted/50 px-3 py-2">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={checked => setSelected((current) => {
                    const next = new Set(current)
                    for (const session of selectableSessions) {
                      if (checked) { next.add(session.id) }
                      else { next.delete(session.id) }
                    }
                    return next
                  })}
                  aria-label={copy.selectAll}
                />
                <div className="relative min-w-48 flex-1">
                  <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={copy.searchPlaceholder}
                    className="h-7 bg-background pl-8 text-[12px]"
                  />
                </div>
                {selected.size > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="px-1 text-[11px] tabular-nums text-muted-foreground">{copy.selected(selected.size)}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => requestAction('purge-transcripts', [...selected])}
                      disabled={busy}
                    >
                      <EraserIcon />
                      {copy.clearSelected}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => requestAction('delete-sessions', [...selected])}
                      disabled={busy}
                    >
                      <DeleteIcon />
                      {copy.deleteSelected}
                    </Button>
                  </div>
                )}
              </div>

              <div className="divide-y divide-border/60">
                {sessions.map(session => (
                  <SessionStorageRow
                    key={session.id}
                    session={session}
                    copy={copy}
                    selected={selected.has(session.id)}
                    disabled={busy}
                    onSelectedChange={checked => setSelected((current) => {
                      const next = new Set(current)
                      if (checked) { next.add(session.id) }
                      else { next.delete(session.id) }
                      return next
                    })}
                    onAction={action => requestAction(action, [session.id])}
                  />
                ))}
                {!loading && !error && sessions.length === 0 && (
                  <div className="px-4 py-14 text-center text-[12px] text-muted-foreground">
                    {overview?.sessions.length ? copy.noMatches : copy.empty}
                  </div>
                )}
                {error && (
                  <div className="px-4 py-14 text-center text-[12px] text-destructive">
                    {copy.error}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        <AlertDialog open={Boolean(confirmation)} onOpenChange={open => !open && setConfirmation(null)}>
          {confirmation && (
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirmation.action === 'delete-sessions'
                    ? copy.confirmDeleteTitle(confirmation.sessionIds.length)
                    : copy.confirmClearTitle(confirmation.sessionIds.length)}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmation.action === 'delete-sessions'
                    ? copy.confirmDeleteDescription
                    : copy.confirmClearDescription}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    onAction(confirmation.action, confirmation.sessionIds)
                    setConfirmation(null)
                  }}
                >
                  {confirmation.action === 'delete-sessions' ? copy.confirmDelete : copy.confirmClear}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </AlertDialog>
      </div>
    </TooltipProvider>
  )
}

function StorageSummary({ overview, copy, loading, error }: {
  overview: GetStorageOverviewResponse | null
  copy: StorageManagerCopy
  loading: boolean
  error: boolean
}) {
  const total = Math.max(overview?.totalBytes ?? 0, 1)
  return (
    <section className="rounded-lg bg-card p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] text-muted-foreground">{copy.totalUsed}</p>
          <p className="mt-0.5 text-[26px] font-semibold leading-none tabular-nums text-foreground">
            {loading && !overview ? '...' : formatBytes(overview?.totalBytes ?? 0)}
          </p>
        </div>
        <p className="max-w-md truncate font-mono text-[10px] text-muted-foreground" title={overview?.dataDirectory}>
          {error ? '' : overview?.dataDirectory ?? copy.measuredNow}
        </p>
      </div>
      <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {overview?.categories.map(category => (
          <div
            key={category.id}
            className={categoryVisuals[category.id].bar}
            style={{ width: `${Math.max(0, (category.bytes / total) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {overview?.categories.map(category => (
          <CategoryItem key={category.id} category={category} copy={copy} />
        ))}
      </div>
    </section>
  )
}

function CategoryItem({ category, copy }: { category: StorageCategory, copy: StorageManagerCopy }) {
  const visual = categoryVisuals[category.id]
  const Icon = visual.icon
  const detail = `${formatBytes(category.bytes)} · ${copy.categoryFiles(category.fileCount)}`
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className={cn('size-2 shrink-0 rounded-[2px]', visual.bar)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-foreground">{copy.categories[category.id]}</p>
        <p className="text-[10px] tabular-nums text-muted-foreground">
          {detail}
        </p>
      </div>
    </div>
  )
}

function SessionStorageRow({ session, copy, selected, disabled, onSelectedChange, onAction }: {
  session: StorageSession
  copy: StorageManagerCopy
  selected: boolean
  disabled: boolean
  onSelectedChange: (checked: boolean) => void
  onAction: (action: StorageManagerAction) => void
}) {
  return (
    <div className="group flex min-w-0 items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
      <Checkbox
        checked={selected}
        onCheckedChange={checked => onSelectedChange(Boolean(checked))}
        disabled={session.active || disabled}
        aria-label={session.title}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[13px] font-medium text-foreground">{session.title}</p>
          {session.active && <span className="shrink-0 rounded-sm bg-success/10 px-1.5 py-0.5 text-[10px] text-success">{copy.active}</span>}
          {session.archivedAt && <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{copy.archived}</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
          <span>{session.workspaceName ?? session.runtimeKind}</span>
          <span>{session.runtimeKind}</span>
          <span className="tabular-nums">{copy.messages(session.messageCount)}</span>
          <StoragePart label={copy.localData} bytes={session.localBytes} />
          <StoragePart label={copy.runtimeData} bytes={session.runtimeBytes} />
          <StoragePart label={copy.attachments} bytes={session.attachmentBytes} />
          <StoragePart label={copy.artifacts} bytes={session.artifactBytes} />
          <StoragePart label={copy.terminal} bytes={session.terminalBytes} />
        </div>
      </div>
      <p className="w-16 shrink-0 text-right text-[12px] font-medium tabular-nums text-foreground">
        {formatBytes(session.reclaimableBytes)}
      </p>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger render={(
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onAction('purge-transcripts')}
              disabled={session.active || disabled}
              aria-label={copy.clearTranscript}
            >
              <ClearIcon />
            </Button>
          )}
          />
          <TooltipContent>{copy.clearTranscript}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={(
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onAction('delete-sessions')}
              disabled={session.active || disabled}
              aria-label={copy.deleteSession}
              className="text-muted-foreground hover:text-destructive"
            >
              <DeleteIcon />
            </Button>
          )}
          />
          <TooltipContent>{copy.deleteSession}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function StoragePart({ label, bytes }: { label: string, bytes: number }) {
  if (bytes <= 0) { return null }
  const detail = `${label} ${formatBytes(bytes)}`
  return <span className="tabular-nums">{detail}</span>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B` }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}
