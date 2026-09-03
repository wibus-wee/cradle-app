import {
  CheckLine as CheckIcon,
  CopyLine as CopyIcon,
  CylinderLine as DatabaseIcon,
  Refresh1Line as RefreshIcon,
} from '@mingcute/react'
import { formatDistanceToNow } from 'date-fns'
import { useMemo, useState } from 'react'

import type { GetStorageOverviewResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import type { StorageCategoryId, StorageManagerAction, StorageManagerCopy } from './storage-manager-view'
import { categoryVisuals, formatBytes } from './storage-visuals'

export interface StorageQuickAction {
  id: string
  action: StorageManagerAction
  sessionIds: string[]
  reclaimableBytes: number
  title: string
  description: string
}

interface StorageSummaryViewProps {
  overview: GetStorageOverviewResponse | null
  copy: StorageManagerCopy
  loading: boolean
  error: boolean
  quickActions: StorageQuickAction[]
  selectedCategory: StorageCategoryId | null
  onSelectCategory: (category: StorageCategoryId | null) => void
  onRefresh: () => void
  onAction: (action: StorageManagerAction, sessionIds: string[]) => void
}

export function StorageSummaryView({
  overview,
  copy,
  loading,
  error,
  quickActions,
  selectedCategory,
  onSelectCategory,
  onRefresh,
  onAction,
}: StorageSummaryViewProps) {
  const [copied, setCopied] = useState(false)
  const totalBytes = overview?.totalBytes ?? 0
  const reclaimableBytes = useMemo(
    () => (overview?.sessions ?? []).reduce((sum, session) => sum + session.reclaimableBytes, 0),
    [overview],
  )

  const measuredLabel = useMemo(() => {
    if (!overview) { return loading ? copy.measuredNow : '' }
    return copy.measuredAt(formatDistanceToNow(overview.measuredAt * 1000, { addSuffix: true }))
  }, [overview, loading, copy])

  const handleCopyPath = async () => {
    if (!overview?.dataDirectory) { return }
    try {
      await navigator.clipboard.writeText(overview.dataDirectory)
      setCopied(true)
      setTimeout(setCopied, 2000, false)
    }
    catch {
      // ignore
    }
  }

  return (
    <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 gap-8">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{copy.totalUsed}</p>
            <p className="mt-1 text-[36px] font-semibold leading-none tabular-nums text-foreground">
              {loading && !overview ? '…' : formatBytes(totalBytes)}
            </p>
            <p className="mt-2 text-[12px] text-muted-foreground">
              {copy.reclaimableTotal}
              {' '}
              <span className="font-medium tabular-nums text-foreground">{formatBytes(reclaimableBytes)}</span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger render={(
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onRefresh}
                  disabled={loading}
                  aria-label={copy.refresh}
                >
                  <RefreshIcon className={cn('size-4', loading && 'animate-spin')} />
                </Button>
              )}
              />
              <TooltipContent>{copy.refresh}</TooltipContent>
            </Tooltip>
          </div>
          {overview?.dataDirectory && (
            <div className="flex max-w-xs items-center gap-2">
              <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-[11px] text-muted-foreground" title={overview.dataDirectory}>
                {overview.dataDirectory}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleCopyPath}
                aria-label={copied ? copy.actionCopied : copy.actionCopyPath}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
              </Button>
            </div>
          )}
          {measuredLabel && (
            <p className="text-[11px] text-muted-foreground/70">{measuredLabel}</p>
          )}
        </div>
      </div>

      <div className="mt-6">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {overview?.categories.map((category) => {
            const percentage = totalBytes > 0 ? (category.bytes / totalBytes) * 100 : 0
            return (
              <Tooltip key={category.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onSelectCategory(category.id)}
                    className={cn(
                      'h-full min-w-[2px] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      categoryVisuals[category.id].bar,
                    )}
                    style={{ width: `${percentage}%` }}
                    aria-label={`${copy.categories[category.id]} ${formatBytes(category.bytes)} ${percentage.toFixed(1)}%`}
                  />
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  <div className="font-medium">{copy.categories[category.id]}</div>
                  <div className="tabular-nums text-muted-foreground">
                    {formatBytes(category.bytes)}
                    {' · '}
                    {copy.categoryFiles(category.fileCount)}
                    {' · '}
                    {percentage.toFixed(1)}
                    %
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant={selectedCategory === null ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => onSelectCategory(null)}
          >
            {copy.filterAll}
          </Button>
          {overview?.categories.map((category) => {
            const percentage = totalBytes > 0 ? (category.bytes / totalBytes) * 100 : 0
            const active = selectedCategory === category.id
            return (
              <Button
                key={category.id}
                variant={active ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => onSelectCategory(active ? null : category.id)}
                className="gap-1.5"
              >
                <span className={cn('size-1.5 rounded-full', categoryVisuals[category.id].bar)} />
                <span className="text-foreground">{copy.categories[category.id]}</span>
                <span className="tabular-nums text-muted-foreground">{formatBytes(category.bytes)}</span>
                <span className="tabular-nums text-muted-foreground/70">
{percentage.toFixed(0)}
%
                </span>
              </Button>
            )
          })}
        </div>
      </div>

      {!loading && error && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-lg bg-destructive/10 px-4 py-3">
          <p className="text-[12px] text-destructive">{copy.error}</p>
          <Button variant="outline" size="sm" onClick={onRefresh}>{copy.actionRetry}</Button>
        </div>
      )}

      {!loading && !error && quickActions.length > 0 && (
        <div className="mt-5 border-t border-border/60 pt-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{copy.quickCleanTitle}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickActions.map(action => (
              <div
                key={action.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-foreground">{action.title}</p>
                  <p className="text-[11px] text-muted-foreground">{action.description}</p>
                </div>
                <Button
                  variant={action.action === 'delete-sessions' ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => onAction(action.action, action.sessionIds)}
                  disabled={action.sessionIds.length === 0}
                >
                  {action.action === 'delete-sessions' ? copy.deleteSelected : copy.clearSelected}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
