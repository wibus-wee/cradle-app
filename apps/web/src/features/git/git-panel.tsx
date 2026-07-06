import {
  ArrowDownLine as ArrowDownIcon,
  ArrowUpLine as ArrowUpIcon,
  GitBranch2Line as GitGraphIcon,
  GitBranchLine as GitBranchIcon,
  Refresh1Line as RefreshCwIcon,
} from '@mingcute/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VListHandle } from 'virtua'
import { VList } from 'virtua'

import { postWorkspacesByWorkspaceIdGitFetchMutation } from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import { TooltipProvider } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import { BranchPicker } from './branch-picker'
import { GitGraphRow, ROW_HEIGHT } from './git-graph-row'
import { computeGraphLayout } from './graph-layout'
import type { GitRepository } from './types'
import {
  gitBranchesQueryKey,
  gitGraphQueryKey,
  gitRepositoriesQueryKey,
  gitStatusQueryKey,
  useGitGraph,
  useGitRepositories,
} from './use-git'

interface GitPanelProps {
  workspaceId: string | null | undefined
  sessionId?: string | null
}

export function GitPanel({ workspaceId, sessionId }: GitPanelProps) {
  const { t } = useTranslation('git')
  const {
    data: repositories,
    isLoading,
    isError,
    isSuccess,
  } = useGitRepositories(workspaceId, sessionId)
  const gitRepositories = repositories ?? []

  if (!workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center" data-testid="git-panel-empty-workspace">
        <p className="text-xs text-muted-foreground">{t('panel.emptyWorkspace')}</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center" data-testid="git-panel-error">
        <div className="flex flex-col items-center gap-2">
          <GitGraphIcon className="size-5 !text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">{t('panel.error')}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="git-panel"
      data-right-aside-git-ready={isSuccess ? 'true' : 'false'}
    >
      {isLoading
        ? (
          <div className="flex flex-1 items-center justify-center" data-testid="git-panel-loading">
            <RefreshCwIcon className="size-4 animate-spin !text-muted-foreground/30" aria-hidden />
          </div>
        )
        : gitRepositories.length === 0
          ? (
            <div className="flex flex-1 items-center justify-center p-4" data-testid="git-panel-empty">
              <p className="text-xs text-muted-foreground">No Git repositories found</p>
            </div>
          )
          : gitRepositories.length === 1
            ? (
              <GitRepositoryPanelSection
                workspaceId={workspaceId}
                repository={gitRepositories[0]!}
                showRepositoryHeader={false}
              />
              )
            : (
              <div className="min-h-0 flex-1 overflow-y-auto py-2" data-testid="git-panel-repositories">
                {gitRepositories.map(repository => (
                  <section
                    key={repository.path}
                    className="px-2 pb-3 last:pb-1"
                    data-testid="git-panel-repository-section"
                  >
                    <GitRepositoryPanelSection
                      workspaceId={workspaceId}
                      repository={repository}
                      showRepositoryHeader
                    />
                  </section>
                ))}
              </div>
              )}
    </div>
  )
}

function GitRepositoryPanelSection({
  workspaceId,
  repository,
  showRepositoryHeader,
}: {
  workspaceId: string
  repository: GitRepository
  showRepositoryHeader: boolean
}) {
  const { t } = useTranslation('git')
  const [limit, setLimit] = useState(100)
  const {
    data: commits,
    isLoading: graphLoading,
    isFetching: graphFetching,
  } = useGitGraph(workspaceId, limit, repository.path)
  const queryClient = useQueryClient()
  const fetchMutation = useMutation({
    ...postWorkspacesByWorkspaceIdGitFetchMutation(),
    onSuccess: () => invalidateAll(),
  })
  const vListRef = useRef<VListHandle>(null)
  const layoutCommits = commits ? computeGraphLayout(commits) : []

  function invalidateAll() {
    const repositoryQuery = { query: { repo: repository.path } }
    void queryClient.invalidateQueries({ queryKey: gitRepositoriesQueryKey({ path: { workspaceId } }) })
    void queryClient.invalidateQueries({ queryKey: gitStatusQueryKey({ path: { workspaceId }, ...repositoryQuery }) })
    void queryClient.invalidateQueries({ queryKey: gitBranchesQueryKey({ path: { workspaceId }, ...repositoryQuery }) })
    void queryClient.invalidateQueries({ queryKey: gitGraphQueryKey({ path: { workspaceId }, ...repositoryQuery }) })
  }

  const handleFetch = async () => {
    await fetchMutation.mutateAsync({
      path: { workspaceId },
      body: { repo: repository.path },
    })
  }

  const handleRangeChange = (_offset: number) => {
    const handle = vListRef.current
    if (handle && commits && !graphFetching) {
      if (_offset + handle.viewportSize >= handle.scrollSize - handle.viewportSize * 0.5) {
        setLimit(prev => prev + 100)
      }
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden',
        showRepositoryHeader && 'h-96 rounded-md border border-border/35 bg-background/30',
      )}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1" data-testid="git-panel-status-bar">
        {showRepositoryHeader && (
          <div className="mr-1 min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-foreground/85">{repository.name}</div>
            <div className="truncate text-[10px] text-muted-foreground/50">{repository.path}</div>
          </div>
        )}

        <BranchPicker
          workspaceId={workspaceId}
          repositoryPath={repository.path}
          currentBranch={repository.branch}
        >
          <button
            type="button"
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors',
              'text-foreground/80 hover:text-foreground hover:bg-accent/60',
              !showRepositoryHeader && 'max-w-44',
            )}
            data-testid="git-panel-branch-trigger"
            data-branch-name={repository.branch}
            data-repository-path={repository.path}
          >
            <GitBranchIcon className="size-3 shrink-0 !text-muted-foreground/60" aria-hidden />
            <span className="min-w-0 truncate font-medium">{repository.branch}</span>
            {repository.ahead > 0 && (
              <span className="flex items-center gap-px text-[10px] text-primary font-medium tabular-nums">
                <ArrowUpIcon className="size-2.5" aria-hidden />
                {repository.ahead}
              </span>
            )}
            {repository.behind > 0 && (
              <span className="flex items-center gap-px text-[10px] text-amber-500 font-medium tabular-nums">
                <ArrowDownIcon className="size-2.5" aria-hidden />
                {repository.behind}
              </span>
            )}
          </button>
        </BranchPicker>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('panel.fetch')}
          title={t('panel.fetch.title')}
          onClick={() => { void handleFetch() }}
          disabled={fetchMutation.isPending}
          className="text-muted-foreground hover:text-foreground"
          data-testid="git-panel-fetch"
        >
          <RefreshCwIcon className={cn('size-3.5', fetchMutation.isPending && 'animate-spin')} aria-hidden />
        </Button>
      </div>

      {graphLoading
        ? (
          <div className="flex flex-1 items-center justify-center" data-testid="git-commit-graph-loading">
            <RefreshCwIcon className="size-4 animate-spin !text-muted-foreground/30" aria-hidden />
          </div>
        )
        : layoutCommits.length === 0
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
                  data-commit-count={String(layoutCommits.length)}
                  data-repository-path={repository.path}
                >
                  <VList
                    ref={vListRef}
                    className="flex-1 [&::-webkit-scrollbar]:hidden"
                    itemSize={ROW_HEIGHT}
                    onScroll={handleRangeChange}
                  >
                    {layoutCommits.map(commit => (
                      <GitGraphRow key={commit.sha} commit={commit} />
                    ))}
                  </VList>
                </div>
              </TooltipProvider>
              {graphFetching && !graphLoading && (
                <div className="flex shrink-0 items-center justify-center py-1.5">
                  <RefreshCwIcon className="size-3.5 animate-spin !text-muted-foreground/30" aria-hidden />
                </div>
              )}
            </div>
            )}
    </div>
  )
}
