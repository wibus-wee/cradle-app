import {
  GitBranch2Line as GitGraphIcon,
  Refresh1Line as RefreshCwIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { GitRepository } from './types'

export type GitPanelStatus = 'empty-workspace' | 'loading' | 'error' | 'ready'

export interface GitPanelViewProps {
  status: GitPanelStatus
  repositories: GitRepository[]
  renderRepository: (
    repository: GitRepository,
    showRepositoryHeader: boolean,
  ) => ReactNode
}

export function GitPanelView({
  status,
  repositories,
  renderRepository,
}: GitPanelViewProps) {
  const { t } = useTranslation('git')

  if (status === 'empty-workspace') {
    return (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="git-panel-empty-workspace"
      >
        <p className="text-xs text-muted-foreground">{t('panel.emptyWorkspace')}</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div
        className="flex flex-1 items-center justify-center p-4 text-center"
        data-testid="git-panel-error"
      >
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
      data-right-aside-git-ready={status === 'ready' ? 'true' : 'false'}
    >
      {status === 'loading'
        ? (
          <div className="flex flex-1 items-center justify-center" data-testid="git-panel-loading">
            <RefreshCwIcon className="size-4 animate-spin !text-muted-foreground/30" aria-hidden />
          </div>
          )
        : repositories.length === 0
          ? (
            <div className="flex flex-1 items-center justify-center p-4" data-testid="git-panel-empty">
              <p className="text-xs text-muted-foreground">{t('panel.emptyRepositories')}</p>
            </div>
            )
          : repositories.length === 1
            ? renderRepository(repositories[0]!, false)
            : (
              <div className="min-h-0 flex-1 overflow-y-auto py-2" data-testid="git-panel-repositories">
                {repositories.map(repository => (
                  <section
                    key={repository.path}
                    className="px-2 pb-3 last:pb-1"
                    data-testid="git-panel-repository-section"
                  >
                    {renderRepository(repository, true)}
                  </section>
                ))}
              </div>
              )}
    </div>
  )
}
