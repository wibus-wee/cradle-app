import {
  CheckCircleLine as CheckCircleIcon,
  CloudLine as CloudIcon,
  DownloadLine as DownloadIcon,
  ExternalLinkLine as ExternalLinkIcon,
  FolderOpenLine as FolderIcon,
  Link2Line as LinkIcon,
  Refresh1Line as RefreshIcon,
  ServerLine as ServerIcon,
  WarningLine as WarningIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { VList } from 'virtua'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { createStore } from 'zustand/vanilla'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Spinner } from '~/components/ui/spinner'
import { refreshSessionLists } from '~/features/session/api/session-projection'
import { cn } from '~/lib/cn'
import { openChatSession } from '~/navigation/navigation-commands'

import type {
  PostExternalSessionImportImportsResponse,
  PostExternalSessionImportScansResponse,
} from './api/external-session-import'
import {
  getExternalSessionImportImportsOptions,
  getExternalSessionImportImportsQueryKey,
  getWorkspacesQueryKey,
  postExternalSessionImportImportsByImportIdSyncMutation,
  postExternalSessionImportImportsMutation,
  postExternalSessionImportScansMutation,
} from './api/external-session-import'
import { SettingsGroup, SettingsPage } from './settings-container'

type ImportScan = PostExternalSessionImportScansResponse
type ImportCandidate = ImportScan['candidates'][number]
type ImportResultItem = PostExternalSessionImportImportsResponse['items'][number]
type SourceFilter = 'all' | 'claude' | 'codex'
type ImportFilter = 'all' | 'available' | 'update-available' | 'imported'

interface SelectionState {
  candidateIds: Set<string>
  count: number
  clear: () => void
  replace: (candidateIds: string[]) => void
  toggle: (candidateId: string, selected: boolean) => void
}

type SelectionStore = StoreApi<SelectionState>

const CANDIDATE_ROW_SIZE = 116

function createSelectionStore(): SelectionStore {
  return createStore<SelectionState>(set => ({
    candidateIds: new Set(),
    count: 0,
    clear: () => set({ candidateIds: new Set(), count: 0 }),
    replace: candidateIds => set({ candidateIds: new Set(candidateIds), count: candidateIds.length }),
    toggle: (candidateId, selected) => set((current) => {
      if (current.candidateIds.has(candidateId) === selected) {
        return current
      }
      const candidateIds = new Set(current.candidateIds)
      if (selected) {
        candidateIds.add(candidateId)
      }
      else {
        candidateIds.delete(candidateId)
      }
      return { candidateIds, count: current.count + (selected ? 1 : -1) }
    }),
  }))
}

function isImportable(candidate: ImportCandidate): boolean {
  return candidate.importState === 'available'
    || (candidate.importState === 'update-available' && candidate.importRecordId === null)
}

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) {
    return null
  }
  if (bytes < 1_024) {
    return `${bytes} B`
  }
  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(1)} KB`
  }
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function formatDate(timestamp: number | null): string | null {
  if (timestamp === null) {
    return null
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp * 1_000)
}

function workspaceReason(candidate: ImportCandidate, t: TFunction<'settings'>): string {
  switch (candidate.workspacePlan.reason) {
    case 'exact-path':
      return t('import.workspace.exact')
    case 'containing-path':
      return t('import.workspace.ancestor')
    case 'git-identity':
      return t('import.workspace.git')
    case 'import-record':
      return t('import.workspace.importRecord')
    case 'available-project-root':
      return t('import.workspace.register')
    case 'offline-historical-root':
      return t('import.workspace.offline')
  }
}

function importStateLabel(candidate: ImportCandidate, t: TFunction<'settings'>): string {
  if (candidate.importState === 'imported') {
    return t('import.state.imported')
  }
  if (candidate.importState === 'update-available') {
    return candidate.importRecordId ? t('import.state.update') : t('import.state.legacy')
  }
  return t('import.state.ready')
}

function CandidateRow({
  candidate,
  busy,
  importedSessionId,
  selectionStore,
  onSync,
}: {
  candidate: ImportCandidate
  busy: boolean
  importedSessionId: string | null
  selectionStore: SelectionStore
  onSync: (candidate: ImportCandidate) => void
}) {
  const { t } = useTranslation('settings')
  const checked = useStore(selectionStore, state => state.candidateIds.has(candidate.candidateId))
  const toggle = useStore(selectionStore, state => state.toggle)
  const importable = isImportable(candidate)
  const date = formatDate(candidate.updatedAt ?? candidate.createdAt)
  const bytes = formatBytes(candidate.estimatedBytes)

  return (
    <div className="border-b border-border/60 px-3 py-3 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <label className="relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-muted/60">
          <Checkbox
            checked={checked}
            disabled={busy || !importable}
            onCheckedChange={value => toggle(candidate.candidateId, value === true)}
            aria-label={`Select ${candidate.title}`}
          />
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">{candidate.title}</span>
            <Badge variant="outline" className="uppercase">{candidate.sourceApp}</Badge>
            <Badge
              variant={candidate.workspacePlan.availability === 'missing' ? 'destructive' : 'secondary'}
            >
              {candidate.workspacePlan.availability === 'missing' ? t('import.state.missing') : importStateLabel(candidate, t)}
            </Badge>
          </div>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground text-pretty">
            <FolderIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
{candidate.workspacePlan.name}
{' '}
·
{' '}
{candidate.workspacePlan.path}
            </span>
          </p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
            {workspaceReason(candidate, t)}
            {date ? ` · ${date}` : ''}
            {bytes ? ` · ${bytes}` : ''}
            {candidate.childSessionCount ? ` · ${candidate.childSessionCount} subagents` : ''}
          </p>
          {candidate.summary
? (
            <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground text-pretty">{candidate.summary}</p>
          )
: null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {candidate.importState === 'update-available' && candidate.importRecordId
? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onSync(candidate)}
            >
              <RefreshIcon />
              {t('import.action.sync')}
            </Button>
          )
: null}
          {importedSessionId
? (
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => openChatSession(importedSessionId)} aria-label={t('import.action.open')}>
              <ExternalLinkIcon />
            </Button>
          )
: null}
        </div>
      </div>
    </div>
  )
}

function FilterButton({ active, children, onClick }: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={active ? 'secondary' : 'ghost'}
      onClick={onClick}
      className="transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96]"
    >
      {children}
    </Button>
  )
}

export function ExternalWorkImportSettings() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [scan, setScan] = useState<ImportScan | null>(null)
  const [selectionStore] = useState(createSelectionStore)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [importFilter, setImportFilter] = useState<ImportFilter>('all')
  const [results, setResults] = useState<ImportResultItem[]>([])
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const scanMutation = useMutation(postExternalSessionImportScansMutation())
  const importMutation = useMutation(postExternalSessionImportImportsMutation())
  const syncMutation = useMutation(postExternalSessionImportImportsByImportIdSyncMutation())
  const importsQuery = useQuery(getExternalSessionImportImportsOptions())
  const selectedCount = useStore(selectionStore, state => state.count)
  const busy = scanMutation.isPending || importMutation.isPending || syncMutation.isPending

  const importedSessionByRecordId = useMemo(() => new Map(
    (importsQuery.data ?? []).map(record => [record.id, record.sessionId]),
  ), [importsQuery.data])

  const candidates = useMemo(() => (scan?.candidates ?? []).filter((candidate) => {
    if (sourceFilter !== 'all' && candidate.sourceApp !== sourceFilter) {
      return false
    }
    return importFilter === 'all' || candidate.importState === importFilter
  }), [importFilter, scan?.candidates, sourceFilter])

  const importableCandidateIds = useMemo(() => candidates
    .filter(isImportable)
    .map(candidate => candidate.candidateId), [candidates])
  const workspaceCount = useMemo(() => new Set(
    (scan?.candidates ?? []).map(candidate => candidate.workspacePlan.historicalKey),
  ).size, [scan?.candidates])
  const missingWorkspaceCount = useMemo(() => new Set(
    (scan?.candidates ?? [])
      .filter(candidate => candidate.workspacePlan.availability === 'missing')
      .map(candidate => candidate.workspacePlan.historicalKey),
  ).size, [scan?.candidates])

  const runScan = async () => {
    setStatusMessage(null)
    setResults([])
    selectionStore.getState().clear()
    try {
      const nextScan = await scanMutation.mutateAsync({ body: { limitPerSource: 2_000 } })
      setScan(nextScan)
      setStatusMessage(t('import.status.scanned', { count: nextScan.candidates.length }))
    }
    catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const importSelected = async () => {
    if (!scan || selectedCount === 0) {
      return
    }
    setStatusMessage(null)
    try {
      const result = await importMutation.mutateAsync({
        body: {
          scanId: scan.id,
          candidateIds: [...selectionStore.getState().candidateIds],
        },
      })
      setResults(result.items)
      selectionStore.getState().clear()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getExternalSessionImportImportsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getWorkspacesQueryKey() }),
        refreshSessionLists(queryClient),
      ])
      setStatusMessage(t('import.status.imported', {
        imported: result.imported,
        duplicates: result.duplicates,
        skipped: 0,
        errors: result.errors,
      }))
      const nextScan = await scanMutation.mutateAsync({ body: { limitPerSource: 2_000 } })
      setScan(nextScan)
    }
    catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const syncCandidate = async (candidate: ImportCandidate) => {
    if (!scan || !candidate.importRecordId) {
      return
    }
    setStatusMessage(null)
    try {
      const result = await syncMutation.mutateAsync({
        path: { importId: candidate.importRecordId },
        body: { scanId: scan.id, candidateId: candidate.candidateId },
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getExternalSessionImportImportsQueryKey() }),
        refreshSessionLists(queryClient),
      ])
      setStatusMessage(result.status === 'diverged'
        ? result.reason
        : t('import.status.synced', { count: result.appendedMessages }))
      const nextScan = await scanMutation.mutateAsync({ body: { limitPerSource: 2_000 } })
      setScan(nextScan)
    }
    catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <SettingsPage
      title={t('import.page.title')}
      description={t('import.page.description')}
      action={(
<Badge variant="outline">
<ServerIcon />
{' '}
{t('import.badge.local')}
</Badge>
)}
      maxWidth="4xl"
      className="h-full min-h-0 pb-0"
      data-testid="external-work-import-settings"
    >
      <Alert>
        <LinkIcon className="size-4" aria-hidden="true" />
        <AlertTitle>{t('import.alert.title')}</AlertTitle>
        <AlertDescription>
          {t('import.alert.description')}
        </AlertDescription>
      </Alert>

      <SettingsGroup bare className="overflow-hidden">
        <div className="grid grid-cols-3 gap-px bg-border/60">
          <ImportStat label={t('import.stat.sessions')} value={scan?.candidates.length ?? 0} icon={<DownloadIcon />} />
          <ImportStat label={t('import.stat.workspaces')} value={workspaceCount} icon={<FolderIcon />} />
          <ImportStat label={t('import.stat.offline')} value={missingWorkspaceCount} icon={<CloudIcon />} warning={missingWorkspaceCount > 0} />
        </div>
      </SettingsGroup>

      <SettingsGroup
        bare
        label={t('import.center.title')}
        description={t('import.center.description')}
        action={(
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runScan()}>
              {scanMutation.isPending ? <Spinner /> : <RefreshIcon />}
              {scan ? t('import.action.scanAgain') : t('import.action.scan')}
            </Button>
            <Button type="button" size="sm" disabled={busy || selectedCount === 0} onClick={() => void importSelected()}>
              {importMutation.isPending ? <Spinner /> : <DownloadIcon />}
              {t('import.action.import')}
{' '}
<span className="tabular-nums">{selectedCount || ''}</span>
            </Button>
          </div>
        )}
        sectionClassName="min-h-0 flex-1"
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div className="flex items-center gap-1">
            {(['all', 'claude', 'codex'] as const).map(source => (
              <FilterButton key={source} active={sourceFilter === source} onClick={() => setSourceFilter(source)}>
                {source === 'all' ? t('import.filter.allSources') : source}
              </FilterButton>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {(['all', 'available', 'update-available', 'imported'] as const).map(state => (
              <FilterButton key={state} active={importFilter === state} onClick={() => setImportFilter(state)}>
                {state === 'all' ? t('import.filter.allStates') : t(`import.filter.${state}`)}
              </FilterButton>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="tabular-nums">{t('import.selection.summary', { selected: selectedCount, count: candidates.length })}</span>
          <div className="flex items-center gap-1">
            <Button type="button" size="xs" variant="ghost" disabled={busy || importableCandidateIds.length === 0} onClick={() => selectionStore.getState().replace(importableCandidateIds)}>
              {t('import.selection.selectShown')}
            </Button>
            <Button type="button" size="xs" variant="ghost" disabled={busy || selectedCount === 0} onClick={() => selectionStore.getState().clear()}>
              {t('import.selection.clear')}
            </Button>
          </div>
        </div>

        {scan === null && !scanMutation.isPending
? (
          <div className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center">
            <FolderIcon className="size-6 text-muted-foreground/60" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-medium text-foreground text-balance">{t('import.empty.title')}</h3>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground text-pretty">
              {t('import.empty.description')}
            </p>
          </div>
        )
: scanMutation.isPending && scan === null
? (
          <div className="flex min-h-64 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Spinner />
{' '}
{t('import.status.scanning')}
          </div>
        )
: candidates.length === 0
? (
          <div className="flex min-h-48 flex-1 items-center justify-center text-xs text-muted-foreground">
            {t('import.empty.filtered')}
          </div>
        )
: (
          <VList className="min-h-0 flex-1" data={candidates} itemSize={CANDIDATE_ROW_SIZE}>
            {candidate => (
              <CandidateRow
                key={candidate.candidateId}
                candidate={candidate}
                busy={busy}
                importedSessionId={candidate.importRecordId
                  ? importedSessionByRecordId.get(candidate.importRecordId) ?? null
                  : null}
                selectionStore={selectionStore}
                onSync={candidateToSync => void syncCandidate(candidateToSync)}
              />
            )}
          </VList>
        )}
      </SettingsGroup>

      {scan?.warnings.length
? (
        <Alert variant="destructive">
          <WarningIcon className="size-4" aria-hidden="true" />
          <AlertTitle>{t('import.warning.title')}</AlertTitle>
          <AlertDescription>{scan.warnings.join(' ')}</AlertDescription>
        </Alert>
      )
: null}

      {results.length > 0
? (
        <SettingsGroup label={t('import.results.title')} description={t('import.results.description')}>
          {results.map(result => (
            <div key={result.candidateId} className="flex min-h-12 items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                {result.status === 'error'
                  ? <WarningIcon className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                  : <CheckCircleIcon className="size-4 shrink-0 text-success" aria-hidden="true" />}
                <span className="truncate text-xs text-foreground">
                  {result.reason ?? (result.status === 'imported'
                    ? t('import.state.imported')
                    : result.status === 'duplicate' ? t('import.badge.duplicate') : 'Error')}
                </span>
              </div>
              {result.sessionId
? (
                <Button type="button" size="sm" variant="outline" onClick={() => openChatSession(result.sessionId!)}>
                  {t('import.action.open')}
{' '}
<ExternalLinkIcon />
                </Button>
              )
: null}
            </div>
          ))}
        </SettingsGroup>
      )
: null}

      {statusMessage
? (
        <p className={cn(
          'flex items-center gap-2 text-xs text-muted-foreground text-pretty',
          (scanMutation.isError || importMutation.isError || syncMutation.isError) && 'text-destructive',
        )} data-testid="external-work-import-status"
        >
          {scanMutation.isError || importMutation.isError || syncMutation.isError
            ? <WarningIcon className="size-3.5 shrink-0" aria-hidden="true" />
            : <CheckCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />}
          {statusMessage}
        </p>
      )
: null}
    </SettingsPage>
  )
}

function ImportStat({ label, value, icon, warning = false }: {
  label: string
  value: number
  icon: React.ReactNode
  warning?: boolean
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 bg-card px-4 py-3">
      <span className={cn('text-muted-foreground [&>svg]:size-4', warning && 'text-destructive')}>{icon}</span>
      <div>
        <div className="text-lg font-semibold leading-none tabular-nums text-foreground">{value}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  )
}
