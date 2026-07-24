import {
  GitBranchLine as GitBranchIcon,
  Scan2Line as ScanEyeIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import type { GitRepository } from '../../shared/types'
import type { ChangesViewMode } from './changes-panel-view'

export interface ChangesRepositoryListViewProps {
  repositories: GitRepository[]
  viewMode: ChangesViewMode
  onReviewRepository: (repository: GitRepository) => void
  renderRepositoryChanges: (repository: GitRepository) => ReactNode
}

export function ChangesRepositoryListView({
  repositories,
  viewMode,
  onReviewRepository,
  renderRepositoryChanges,
}: ChangesRepositoryListViewProps) {
  const { t } = useTranslation('git')
  const changedRepositories = repositories.filter(
    repository => repository.files.length > 0,
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2" data-testid="changes-panel-repositories">
      {changedRepositories.map(repository => (
        <section
          key={repository.path}
          className="px-2 pb-3 last:pb-1"
          data-testid="changes-repository-section"
        >
          <div className="mb-1 flex h-7 min-w-0 items-center gap-2 px-1">
            <GitBranchIcon className="size-3.5 shrink-0 !text-muted-foreground/50" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-xs font-medium text-foreground/85">
                  {repository.name}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">
                  {repository.files.length}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/50">
                <span className="min-w-0 truncate">{repository.branch}</span>
                {repository.path !== '.' && (
                  <span className="min-w-0 truncate">{repository.path}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onReviewRepository(repository)}
              className="flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-medium text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              data-testid="changes-repository-review"
            >
              <ScanEyeIcon className="size-3" aria-hidden />
              {t('changes.review')}
            </button>
          </div>
          <div
            className={cn(
              'min-h-0 overflow-hidden rounded-md border border-border/35 bg-background/30',
              viewMode === 'tree' && 'h-64',
            )}
          >
            {renderRepositoryChanges(repository)}
          </div>
        </section>
      ))}
    </div>
  )
}
