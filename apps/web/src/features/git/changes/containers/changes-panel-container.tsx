import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { openWorkspaceDiffs } from '~/navigation/navigation-commands'
import { useBrowserPanelStore } from '~/store/browser-panel'

import type { GitRepository } from '../../shared/types'
import { useGitRepositories } from '../../shared/use-git'
import { groupGitFileStatuses } from '../lib/changes-grouping'
import { getWorkspaceDiffRepositoryPath } from '../lib/changes-paths'
import type { ChangesViewMode } from '../views/changes-panel-view'
import { ChangesPanelView } from '../views/changes-panel-view'
import { ChangesTypeView } from '../views/changes-type-view'
import { ChangesTreeContainer } from './changes-tree-container'

export interface ChangesPanelContainerProps {
  workspaceId: string | null | undefined
  workspacePath?: string | null
  sessionId?: string | null
}

export function ChangesPanelContainer({
  workspaceId,
  workspacePath,
  sessionId,
}: ChangesPanelContainerProps) {
  const { t } = useTranslation('git')
  const {
    data: repositories,
    isLoading,
    isError,
  } = useGitRepositories(workspaceId, sessionId)
  const gitRepositories = repositories ?? []
  const openWorkspaceDiffTab = useBrowserPanelStore(state => state.openWorkspaceDiffTab)
  const requestScrollToFilePath = useBrowserPanelStore(state => state.requestScrollToFilePath)

  const handleReviewRepository = (repository: GitRepository) => {
    if (!workspaceId) {
      return
    }
    openWorkspaceDiffs({ workspaceId, repositoryPath: repository.path })
  }

  const handlePreviewFile = (repository: GitRepository, path: string) => {
    if (!workspaceId) {
      return
    }
    const tabId = openWorkspaceDiffTab({
      workspaceId,
      sessionId,
      repositoryPath: getWorkspaceDiffRepositoryPath(
        repository.path,
        gitRepositories.length,
      ),
      title: t('changes.allChangesTitle'),
    })
    requestScrollToFilePath({ path, tabId })
  }

  const renderRepositoryChanges = (
    repository: GitRepository,
    viewMode: ChangesViewMode,
  ): ReactNode => {
    if (viewMode === 'tree') {
      if (!workspaceId) {
        return null
      }
      return (
        <ChangesTreeContainer
          files={repository.files}
          repositoryPath={repository.path}
          workspaceId={workspaceId}
          workspacePath={workspacePath ?? undefined}
          onFileClick={path => handlePreviewFile(repository, path)}
        />
      )
    }

    return (
      <ChangesTypeView
        sections={groupGitFileStatuses(repository.files)}
        onFileClick={path => handlePreviewFile(repository, path)}
      />
    )
  }

  return (
    <ChangesPanelView
      status={
        !workspaceId
          ? 'empty-workspace'
          : isError
            ? 'error'
            : isLoading
              ? 'loading'
              : 'ready'
      }
      repositories={gitRepositories}
      onReviewRepository={handleReviewRepository}
      renderRepositoryChanges={renderRepositoryChanges}
    />
  )
}
