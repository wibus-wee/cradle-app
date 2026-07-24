import {
  GitCompareLine as FileDiffIcon,
  Scan2Line as ScanEyeIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Spinner } from '~/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

import type { GitRepository } from '../../shared/types'
import { ChangesRepositoryListView } from './changes-repository-list-view'

export type ChangesPanelStatus = 'empty-workspace' | 'loading' | 'error' | 'ready'
export type ChangesViewMode = 'type' | 'tree'

export interface ChangesPanelViewProps {
  status: ChangesPanelStatus
  repositories: GitRepository[]
  initialViewMode?: ChangesViewMode
  onReviewRepository: (repository: GitRepository) => void
  renderRepositoryChanges: (
    repository: GitRepository,
    viewMode: ChangesViewMode,
  ) => ReactNode
}

export function ChangesPanelView({
  status,
  repositories,
  initialViewMode = 'type',
  onReviewRepository,
  renderRepositoryChanges,
}: ChangesPanelViewProps) {
  const { t } = useTranslation('git')
  const [viewMode, setViewMode] = useState<ChangesViewMode>(initialViewMode)
  const changedFileCount = repositories.reduce(
    (total, repository) => total + repository.files.length,
    0,
  )

  if (status === 'empty-workspace') {
    return (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="changes-panel-empty-workspace"
      >
        <p className="text-xs text-muted-foreground">{t('changes.emptyWorkspace')}</p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center" data-testid="changes-panel-loading">
        <Spinner className="size-4 !text-muted-foreground/40" aria-hidden />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="changes-panel-error"
      >
        <div className="flex flex-col items-center gap-2">
          <FileDiffIcon className="size-5 !text-muted-foreground/30" aria-hidden />
          <p className="text-xs text-muted-foreground">{t('changes.error')}</p>
        </div>
      </div>
    )
  }

  let changesContent: ReactNode
  if (repositories.length === 0) {
    changesContent = (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="changes-panel-empty"
      >
        <p className="text-xs text-muted-foreground">{t('changes.emptyRepositories')}</p>
      </div>
    )
  }
  else if (changedFileCount === 0) {
    changesContent = (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="changes-panel-empty"
      >
        <p className="text-xs text-muted-foreground">{t('changes.emptyWorkingTree')}</p>
      </div>
    )
  }
  else if (repositories.length === 1) {
    changesContent = renderRepositoryChanges(repositories[0]!, viewMode)
  }
  else {
    changesContent = (
      <ChangesRepositoryListView
        repositories={repositories}
        viewMode={viewMode}
        onReviewRepository={onReviewRepository}
        renderRepositoryChanges={repository =>
          renderRepositoryChanges(repository, viewMode)}
      />
    )
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="changes-panel"
      data-right-aside-changes-ready="true"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2.5">
        <FileDiffIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">
          {t('changes.title')}
        </span>
        <span
          className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55"
          data-testid="changes-panel-count"
        >
          {changedFileCount}
        </span>
        {changedFileCount > 0 && repositories.length === 1 && (
          <button
            type="button"
            onClick={() => onReviewRepository(repositories[0]!)}
            className="flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            data-testid="changes-review-all"
          >
            <ScanEyeIcon className="size-3" aria-hidden />
            {t('changes.review')}
          </button>
        )}
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(value) => {
            if (value === 'type' || value === 'tree') {
              setViewMode(value)
            }
          }}
          variant="outline"
          size="sm"
          className="h-5 shrink-0 gap-px rounded-md"
          aria-label={t('changes.viewMode.label')}
          data-testid="changes-view-mode"
        >
          <ToggleGroupItem
            value="type"
            aria-label={t('changes.viewMode.typeLabel')}
            className="h-5 px-1.5 text-[10px]"
          >
            {t('changes.viewMode.type')}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="tree"
            aria-label={t('changes.viewMode.treeLabel')}
            className="h-5 px-1.5 text-[10px]"
          >
            {t('changes.viewMode.tree')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {changesContent}
    </div>
  )
}
