import type { ReactNode } from 'react'

import { GitPanelView } from './git-panel-view'
import { GitRepositoryPanelSectionContainer } from './git-repository-panel-section-container'
import type { GitRepository } from './types'
import { useGitRepositories } from './use-git'

export interface GitPanelContainerProps {
  workspaceId: string | null | undefined
  sessionId?: string | null
}

export function GitPanelContainer({
  workspaceId,
  sessionId,
}: GitPanelContainerProps) {
  const {
    data: repositories,
    isLoading,
    isError,
  } = useGitRepositories(workspaceId, sessionId)

  const renderRepository = (
    repository: GitRepository,
    showRepositoryHeader: boolean,
  ): ReactNode => {
    if (!workspaceId) {
      return null
    }

    return (
      <GitRepositoryPanelSectionContainer
        workspaceId={workspaceId}
        repository={repository}
        showRepositoryHeader={showRepositoryHeader}
      />
    )
  }

  return (
    <GitPanelView
      status={
        !workspaceId
          ? 'empty-workspace'
          : isError
            ? 'error'
            : isLoading
              ? 'loading'
              : 'ready'
      }
      repositories={repositories ?? []}
      renderRepository={renderRepository}
    />
  )
}
