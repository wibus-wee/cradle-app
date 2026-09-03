import {
  CloseLine as CloseIcon,
  Delete2Line as DeleteIcon,
  EraserLine as EraserIcon,
  SearchLine as SearchIcon,
} from '@mingcute/react'
import { useEffect, useMemo, useRef } from 'react'

import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { cn } from '~/lib/cn'

import type { StorageManagerAction, StorageManagerCopy } from './storage-manager-view'
import { StorageSessionRowView } from './storage-session-row-view'
import type { StorageCategoryId, StorageSession } from './storage-visuals'
import { categoryVisuals, formatBytes } from './storage-visuals'

export type StorageSessionSort = 'reclaimable' | 'total' | 'recent' | 'name'

interface StorageSessionListViewProps {
  sessions: StorageSession[]
  categories: StorageCategoryId[]
  totalSessionCount: number
  copy: StorageManagerCopy
  loading: boolean
  error: boolean
  busy: boolean
  selected: Set<string>
  query: string
  sort: StorageSessionSort
  categoryFilter: StorageCategoryId | null
  onQueryChange: (query: string) => void
  onSortChange: (sort: StorageSessionSort) => void
  onCategoryFilterChange: (category: StorageCategoryId | null) => void
  onSelectedChange: (id: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  onAction: (action: StorageManagerAction, sessionIds: string[]) => void
  onRetry: () => void
}

const sortOptions: StorageSessionSort[] = ['reclaimable', 'total', 'recent', 'name']
const loadingRows = ['first', 'second', 'third', 'fourth'] as const

export function StorageSessionListView({
  sessions,
  categories,
  totalSessionCount,
  copy,
  loading,
  error,
  busy,
  selected,
  query,
  sort,
  categoryFilter,
  onQueryChange,
  onSortChange,
  onCategoryFilterChange,
  onSelectedChange,
  onSelectAll,
  onAction,
  onRetry,
}: StorageSessionListViewProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
      if (event.key === 'Escape' && query && document.activeElement === searchInputRef.current) {
        onQueryChange('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [query, onQueryChange])

  const selectableSessions = sessions.filter(session => !session.active)
  const allVisibleSelected = selectableSessions.length > 0
    && selectableSessions.every(session => selected.has(session.id))

  const selectedSessions = useMemo(
    () => sessions.filter(session => selected.has(session.id)),
    [sessions, selected],
  )
  const selectedReclaimable = useMemo(
    () => selectedSessions.reduce((sum, session) => sum + session.reclaimableBytes, 0),
    [selectedSessions],
  )

  return (
    <section className="overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[13px] font-medium text-foreground">{copy.sessionsTitle}</h2>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {copy.sessionsCount(sessions.length)}
          </span>
        </div>
        <Select value={sort} onValueChange={(value) => { onSortChange(value as StorageSessionSort) }}>
          <SelectTrigger size="sm" className="h-7 w-36 text-xs">
            <SelectValue>{copy.sortLabels[sort]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map(option => (
              <SelectItem key={option} value={option} className="text-xs">
                {copy.sortLabels[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-y border-border/60 bg-muted/40 px-3 py-2">
        <Button
          variant={categoryFilter === null ? 'secondary' : 'ghost'}
          size="xs"
          onClick={() => onCategoryFilterChange(null)}
        >
          {copy.filterAll}
        </Button>
        {categories.map((category) => {
          const active = categoryFilter === category
          return (
            <Button
              key={category}
              variant={active ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => onCategoryFilterChange(active ? null : category)}
              className="gap-1.5"
            >
              <span className={cn('size-1.5 rounded-full', categoryVisuals[category].bar)} />
              {copy.categories[category]}
            </Button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <Checkbox
          checked={allVisibleSelected}
          onCheckedChange={checked => onSelectAll(Boolean(checked))}
          aria-label={copy.selectAll}
        />
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder={copy.searchPlaceholder}
            className="h-7 bg-background pl-8 pr-16 text-[12px]"
          />
          {!query && (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/60">
              {copy.searchShortcut}
            </span>
          )}
          {query && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onQueryChange('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-label={copy.actionCancel}
            >
              <CloseIcon className="size-3" />
            </Button>
          )}
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="px-1 text-[11px] tabular-nums text-muted-foreground">
              {copy.selected(selected.size)}
            </span>
            {selectedReclaimable > 0 && (
              <span className="text-[11px] tabular-nums text-success">
                {copy.selectionFreeable(formatBytes(selectedReclaimable))}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAction('purge-transcripts', [...selected])}
              disabled={busy}
            >
              <EraserIcon className="size-3.5" />
              {copy.clearSelected}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onAction('delete-sessions', [...selected])}
              disabled={busy}
            >
              <DeleteIcon className="size-3.5" />
              {copy.deleteSelected}
            </Button>
          </div>
        )}
      </div>

      <div className="divide-y divide-border/60">
        {sessions.map(session => (
          <StorageSessionRowView
            key={session.id}
            session={session}
            copy={copy}
            selected={selected.has(session.id)}
            disabled={busy}
            onSelectedChange={checked => onSelectedChange(session.id, checked)}
            onAction={action => onAction(action, [session.id])}
          />
        ))}
        {!loading && !error && sessions.length === 0 && (
          <div className="px-4 py-12">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {totalSessionCount > 0
                    ? copy.noMatches
                    : categoryFilter
                      ? copy.emptyCategory
                      : copy.empty}
                </EmptyTitle>
                {totalSessionCount === 0 && !categoryFilter && (
                  <EmptyDescription>{copy.searchPlaceholder}</EmptyDescription>
                )}
              </EmptyHeader>
            </Empty>
          </div>
        )}
        {error && (
          <div className="px-4 py-14 text-center">
            <p className="text-[12px] text-destructive">{copy.error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>{copy.actionRetry}</Button>
          </div>
        )}
        {loading && sessions.length === 0 && (
          <div className="space-y-2 px-4 py-6">
            {loadingRows.map(row => (
              <div key={row} className="flex items-center gap-3 py-2">
                <div className="size-4 rounded bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 rounded bg-muted" />
                  <div className="h-2 w-2/3 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
