import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { postWorkspacesByWorkspaceIdGitFetchMutation } from '~/api-gen/@tanstack/react-query.gen'

import { BranchPicker } from '../../branch/branch-picker'
import { computeGraphLayout } from '../../shared/graph-layout'
import type { GitRepository } from '../../shared/types'
import {
  gitBranchesQueryKey,
  gitGraphQueryKey,
  gitRepositoriesQueryKey,
  gitStatusQueryKey,
  useGitGraph,
} from '../../shared/use-git'
import { GitRepositoryPanelSectionView } from '../views/git-repository-panel-section-view'

export interface GitRepositoryPanelSectionContainerProps {
  workspaceId: string
  repository: GitRepository
  showRepositoryHeader: boolean
}

export function GitRepositoryPanelSectionContainer({
  workspaceId,
  repository,
  showRepositoryHeader,
}: GitRepositoryPanelSectionContainerProps) {
  const [limit, setLimit] = useState(100)
  const {
    data: commits,
    isLoading: graphLoading,
    isFetching: graphFetching,
    isError: graphError,
  } = useGitGraph(workspaceId, limit, repository.path)
  const queryClient = useQueryClient()
  const fetchMutation = useMutation({
    ...postWorkspacesByWorkspaceIdGitFetchMutation(),
    onSuccess: () => invalidateAll(),
  })

  function invalidateAll() {
    const repositoryQuery = { query: { repo: repository.path } }
    void queryClient.invalidateQueries({
      queryKey: gitRepositoriesQueryKey({ path: { workspaceId } }),
    })
    void queryClient.invalidateQueries({
      queryKey: gitStatusQueryKey({ path: { workspaceId }, ...repositoryQuery }),
    })
    void queryClient.invalidateQueries({
      queryKey: gitBranchesQueryKey({ path: { workspaceId }, ...repositoryQuery }),
    })
    void queryClient.invalidateQueries({
      queryKey: gitGraphQueryKey({ path: { workspaceId }, ...repositoryQuery }),
    })
  }

  const handleFetch = async () => {
    await fetchMutation.mutateAsync({
      path: { workspaceId },
      body: { repo: repository.path },
    })
  }

  const renderBranchPicker = (trigger: ReactNode) => (
    <BranchPicker
      workspaceId={workspaceId}
      repositoryPath={repository.path}
      currentBranch={repository.branch}
    >
      {trigger}
    </BranchPicker>
  )

  return (
    <GitRepositoryPanelSectionView
      repository={repository}
      showRepositoryHeader={showRepositoryHeader}
      commits={computeGraphLayout(commits ?? [])}
      graphStatus={graphError ? 'error' : graphLoading ? 'loading' : 'ready'}
      graphFetching={graphFetching}
      fetchPending={fetchMutation.isPending}
      renderBranchPicker={renderBranchPicker}
      onFetch={() => {
        void handleFetch()
      }}
      onLoadMore={
        graphFetching
          ? undefined
          : () => setLimit(currentLimit => currentLimit + 100)
      }
    />
  )
}
