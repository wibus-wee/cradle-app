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
import { TooltipProvider } from '~/components/ui/tooltip'

import type { StorageSessionSort } from './storage-session-list-view'
import { StorageSessionListView } from './storage-session-list-view'
import type { StorageQuickAction } from './storage-summary-view'
import { StorageSummaryView } from './storage-summary-view'
import type { StorageCategoryId, StorageSession } from './storage-visuals'
import {
  categorySessionField,
  getSessionTotalBytes,
} from './storage-visuals'

export type StorageManagerAction = 'purge-transcripts' | 'delete-sessions'
export type { StorageCategoryId, StorageQuickAction, StorageSession, StorageSessionSort }

export interface StorageManagerCopy {
  title: string
  description: string
  totalUsed: string
  reclaimableTotal: string
  measuredNow: string
  measuredAt: (time: string) => string
  dataDirectory: string
  refresh: string
  actionCopyPath: string
  actionCopied: string
  actionRetry: string
  actionCancel: string
  categories: Record<StorageCategoryId, string>
  categoryFiles: (count: number) => string
  parts: Record<'local' | 'runtime' | 'attachments' | 'artifacts' | 'terminal', string>
  sessionsTitle: string
  sessionsCount: (count: number) => string
  searchPlaceholder: string
  searchShortcut: string
  sortLabels: Record<StorageSessionSort, string>
  filterAll: string
  selectAll: string
  clearTranscript: string
  deleteSession: string
  selected: (count: number) => string
  selectionFreeable: (size: string) => string
  clearSelected: string
  deleteSelected: string
  empty: string
  emptyCategory: string
  noMatches: string
  error: string
  active: string
  archived: string
  messages: (count: number) => string
  quickCleanTitle: string
  quickCleanArchivedClearDescription: (count: number, size: string) => string
  quickCleanArchivedDeleteDescription: (count: number, size: string) => string
  quickCleanTopClearDescription: (count: number, size: string) => string
  quickCleanClearArchived: string
  quickCleanDeleteArchived: string
  quickCleanClearTop: string
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
  quickActions: StorageQuickAction[]
  loading: boolean
  error: boolean
  busy: boolean
  onRefresh: () => void
  onAction: (action: StorageManagerAction, sessionIds: string[]) => void
}

export function StorageManagerView({
  overview,
  copy,
  quickActions,
  loading,
  error,
  busy,
  onRefresh,
  onAction,
}: StorageManagerViewProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<StorageSessionSort>('reclaimable')
  const [categoryFilter, setCategoryFilter] = useState<StorageCategoryId | null>(null)
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

  const normalizedQuery = query.trim().toLowerCase()
  const categoryField = categoryFilter ? categorySessionField[categoryFilter] : null

  const sessions = useMemo(() => {
    let filtered = (overview?.sessions ?? []).filter((session) => {
      const matchesQuery = !normalizedQuery
        || session.title.toLowerCase().includes(normalizedQuery)
        || session.workspaceName?.toLowerCase().includes(normalizedQuery)
        || session.runtimeKind.toLowerCase().includes(normalizedQuery)
      if (!categoryField) { return matchesQuery }
      return matchesQuery && session[categoryField] > 0
    })

    filtered = filtered.toSorted((left, right) => {
      switch (sort) {
        case 'total':
          return getSessionTotalBytes(right) - getSessionTotalBytes(left)
        case 'recent':
          return right.updatedAt - left.updatedAt
        case 'name':
          return left.title.localeCompare(right.title)
        case 'reclaimable':
        default:
          return right.reclaimableBytes - left.reclaimableBytes
      }
    })

    return filtered
  }, [overview, normalizedQuery, categoryField, sort])

  const categories = useMemo(
    () => (overview?.categories ?? []).map(category => category.id),
    [overview],
  )

  const selectableSessions = sessions.filter(session => !session.active)

  const requestAction = (action: StorageManagerAction, sessionIds: string[]) => {
    if (sessionIds.length > 0) {
      setConfirmation({ action, sessionIds })
    }
  }

  const handleSelectAll = (checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      for (const session of selectableSessions) {
        if (checked) { next.add(session.id) }
        else { next.delete(session.id) }
      }
      return next
    })
  }

  const handleSelectedChange = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) { next.add(id) }
      else { next.delete(id) }
      return next
    })
  }

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col" data-testid="storage-manager">
        <header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-tight text-foreground text-balance">{copy.title}</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground text-pretty">{copy.description}</p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div className="mx-auto flex max-w-5xl flex-col gap-5">
            <StorageSummaryView
              overview={overview}
              copy={copy}
              loading={loading}
              error={error}
              quickActions={quickActions}
              selectedCategory={categoryFilter}
              onSelectCategory={setCategoryFilter}
              onRefresh={onRefresh}
              onAction={requestAction}
            />

            <StorageSessionListView
              sessions={sessions}
              categories={categories}
              totalSessionCount={overview?.sessions.length ?? 0}
              copy={copy}
              loading={loading}
              error={error}
              busy={busy}
              selected={selected}
              query={query}
              sort={sort}
              categoryFilter={categoryFilter}
              onQueryChange={setQuery}
              onSortChange={setSort}
              onCategoryFilterChange={setCategoryFilter}
              onSelectedChange={handleSelectedChange}
              onSelectAll={handleSelectAll}
              onAction={requestAction}
              onRetry={onRefresh}
            />
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
