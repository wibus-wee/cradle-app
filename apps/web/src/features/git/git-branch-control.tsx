import { CloudLine as CloudIcon, GitBranchLine as GitBranchIcon } from '@mingcute/react'

import { cn } from '~/lib/cn'

import { BranchPicker } from './branch-picker'
import { useGitRepositories } from './use-git'

interface GitBranchControlProps {
  workspaceId: string | null | undefined
}

export function GitBranchControl({ workspaceId }: GitBranchControlProps) {
  const { data: repositories, isError } = useGitRepositories(workspaceId)

  if (!workspaceId || isError || !repositories || repositories.length === 0) {
    return null
  }

  if (repositories.length > 1) {
    const changedFileCount = repositories.reduce((total, repository) => total + repository.files.length, 0)
    return (
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs',
          'text-muted-foreground',
        )}
        data-testid="git-branch-control-summary"
        data-repository-count={String(repositories.length)}
      >
        <GitBranchIcon className="size-3 shrink-0" aria-hidden />
        <span className="max-w-28 truncate">
          {repositories.length}
          {' '}
          repos
        </span>
        {changedFileCount > 0 && (
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
            {changedFileCount}
          </span>
        )}
      </div>
    )
  }

  const repository = repositories[0]!

  return (
    <>
      <BranchPicker
        workspaceId={workspaceId}
        repositoryPath={repository.path}
        currentBranch={repository.branch}
      >
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors',
            'text-muted-foreground hover:text-foreground hover:bg-accent/60',
          )}
          data-testid="git-branch-control-trigger"
          data-branch-name={repository.branch}
          data-repository-path={repository.path}
        >
          <GitBranchIcon className="size-3 shrink-0" aria-hidden />
          <span className="max-w-28 truncate">{repository.branch}</span>
          {repository.ahead > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-primary font-medium">
              <CloudIcon className="size-2.5" aria-hidden />
              {repository.ahead}
            </span>
          )}
          {repository.behind > 0 && (
            <span className="text-[10px] text-muted-foreground font-medium">
              ↓
              {repository.behind}
            </span>
          )}
        </button>
      </BranchPicker>
    </>
  )
}
