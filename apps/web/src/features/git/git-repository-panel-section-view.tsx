import {
  ArrowDownLine as ArrowDownIcon,
  ArrowUpLine as ArrowUpIcon,
  GitBranchLine as GitBranchIcon,
  Refresh1Line as RefreshCwIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { VListHandle } from 'virtua'
import { VList } from 'virtua'

import { Button } from '~/components/ui/button'
import { TooltipProvider } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import { GIT_GRAPH_ROW_HEIGHT, GitGraphRowView } from './git-graph-row-view'
import type { LayoutCommit } from './graph-layout'
import type { GitRepository } from './types'

export type GitGraphStatus = 'loading' | 'error' | 'ready'

export interface GitRepositoryPanelSectionViewProps {
  repository: GitRepository
  showRepositoryHeader: boolean
  commits: LayoutCommit[]
  graphStatus: GitGraphStatus
  graphFetching: boolean
  fetchPending: boolean
  renderBranchPicker: (trigger: ReactNode) => ReactNode
  onFetch: () => void
  onLoadMore?: () => void
}

export function GitRepositoryPanelSectionView({
  repository,
  showRepositoryHeader,
  commits,
  graphStatus,
  graphFetching,
  fetchPending,
  renderBranchPicker,
  onFetch,
  onLoadMore,
}: GitRepositoryPanelSectionViewProps) {
  const { t } = useTranslation('git')
  const vListRef = useRef<VListHandle>(null)

  const handleRangeChange = (offset: number) => {
    const handle = vListRef.current
    if (
      handle
      && onLoadMore
      && offset + handle.viewportSize >= handle.scrollSize - handle.viewportSize * 0.5
    ) {
      onLoadMore()
    }
  }

  const branchTrigger = (
    <button
      type="button"
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors',
        'text-foreground/80 hover:bg-accent/60 hover:text-foreground',
        !showRepositoryHeader && 'max-w-44',
      )}
      data-testid="git-panel-branch-trigger"
      data-branch-name={repository.branch}
      data-repository-path={repository.path}
    >
      <GitBranchIcon className="size-3 shrink-0 !text-muted-foreground/60" aria-hidden />
      <span className="min-w-0 truncate font-medium">{repository.branch}</span>
      {repository.ahead > 0 && (
        <span className="flex items-center gap-px text-[10px] font-medium tabular-nums text-primary">
          <ArrowUpIcon className="size-2.5" aria-hidden />
          {repository.ahead}
        </span>
      )}
      {repository.behind > 0 && (
        <span className="flex items-center gap-px text-[10px] font-medium tabular-nums text-amber-500">
          <ArrowDownIcon className="size-2.5" aria-hidden />
          {repository.behind}
        </span>
      )}
    </button>
  )

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden',
        showRepositoryHeader && 'h-96 rounded-md border border-border/35 bg-background/30',
      )}
      data-testid="git-repository-panel"
      data-repository-path={repository.path}
    >
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1"
        data-testid="git-panel-status-bar"
      >
        {showRepositoryHeader && (
          <div className="mr-1 min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-foreground/85">{repository.name}</div>
            <div className="truncate text-[10px] text-muted-foreground/50">{repository.path}</div>
          </div>
        )}

        {renderBranchPicker(branchTrigger)}

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('panel.fetch')}
          title={t('panel.fetch.title')}
          onClick={onFetch}
          disabled={fetchPending}
          className="text-muted-foreground hover:text-foreground"
          data-testid="git-panel-fetch"
        >
          <RefreshCwIcon className={cn('size-3.5', fetchPending && 'animate-spin')} aria-hidden />
        </Button>
      </div>

      {graphStatus === 'loading'
        ? (
          <div className="flex flex-1 items-center justify-center" data-testid="git-commit-graph-loading">
            <RefreshCwIcon className="size-4 animate-spin !text-muted-foreground/30" aria-hidden />
          </div>
          )
        : graphStatus === 'error'
          ? (
            <div className="flex flex-1 items-center justify-center p-4 text-center" data-testid="git-commit-graph-error">
              <p className="text-xs text-muted-foreground">{t('panel.graphError')}</p>
            </div>
            )
          : commits.length === 0
            ? (
              <div className="flex flex-1 items-center justify-center p-4" data-testid="git-commit-graph-empty">
                <p className="text-xs text-muted-foreground">{t('panel.emptyCommits')}</p>
              </div>
              )
            : (
              <div className="flex min-h-0 flex-1 flex-col">
                <TooltipProvider delayDuration={700}>
                  <div
                    className="flex-1"
                    data-testid="git-commit-graph"
                    data-commit-count={String(commits.length)}
                    data-repository-path={repository.path}
                  >
                    <VList
                      ref={vListRef}
                      className="flex-1 [&::-webkit-scrollbar]:hidden"
                      itemSize={GIT_GRAPH_ROW_HEIGHT}
                      onScroll={handleRangeChange}
                    >
                      {commits.map(commit => (
                        <GitGraphRowView key={commit.sha} commit={commit} />
                      ))}
                    </VList>
                  </div>
                </TooltipProvider>
                {graphFetching && (
                  <div className="flex shrink-0 items-center justify-center py-1.5">
                    <RefreshCwIcon className="size-3.5 animate-spin !text-muted-foreground/30" aria-hidden />
                  </div>
                )}
              </div>
              )}
    </div>
  )
}
