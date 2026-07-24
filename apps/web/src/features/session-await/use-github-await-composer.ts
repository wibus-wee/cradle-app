import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  getSessionAwaitsQueryKey,
  getSessionAwaitsSummaryQueryKey,
  postSessionAwaitsMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'
import { useGitRemotes, useGitRepositories } from '~/features/git/shared/use-git'

import {
  derivePullRequestNumberFromStatus,
  selectGitHubRepository,
} from './await-github'
import type {
  GitHubAwaitComposerViewProps,
  GitHubAwaitCreateInput,
} from './github-await-composer-view'
import { prefetchLiveAwaitStatus } from './use-live-await-status'

export function useGitHubAwaitComposer(
  sessionId: string | null,
  workspaceId: string | null,
): GitHubAwaitComposerViewProps {
  const queryClient = useQueryClient()
  const repositoriesQuery = useGitRepositories(workspaceId)
  const selectedRepository = repositoriesQuery.data?.length === 1
    ? repositoriesQuery.data[0]
    : null
  const repositoryPath = selectedRepository?.path ?? null
  const remotesQuery = useGitRemotes(
    repositoryPath ? workspaceId : null,
    repositoryPath,
  )
  const detectedRepository = selectGitHubRepository(remotesQuery.data)
  const detectedPullRequestNumber = derivePullRequestNumberFromStatus(
    selectedRepository,
  )

  const createMutation = useMutation({
    ...postSessionAwaitsMutation(),
    onSuccess: (row) => {
      void prefetchLiveAwaitStatus(queryClient, row.id)
      if (sessionId) {
        void queryClient.invalidateQueries({
          queryKey: getSessionAwaitsQueryKey({ query: { sessionId } }),
        })
        void queryClient.invalidateQueries({
          queryKey: getSessionAwaitsSummaryQueryKey({ query: { sessionId } }),
        })
      }
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: 'Failed to create await',
        description: error instanceof Error
          ? error.message
          : 'GitHub await could not be created',
      })
    },
    meta: { sessionId, workspaceId },
  })

  const createAwait = (input: GitHubAwaitCreateInput) => {
    if (!sessionId || !workspaceId) {
      return
    }
    const { repository, target, sourceKind, reviewMode } = input
    let filter: Record<string, string | number>
    if (sourceKind === 'github-review') {
      if (target.kind !== 'pull-request') {
        return
      }
      filter = {
        repo: repository.fullName,
        pr: target.filter.pr,
        mode: reviewMode,
      }
    }
    else {
      filter = { repo: repository.fullName, ...target.filter }
    }

    createMutation.mutate({
      body: {
        chatSessionId: sessionId,
        workspaceId,
        source: sourceKind,
        filterJson: JSON.stringify(filter),
        reason: sourceKind === 'github-review'
          ? `Waiting for GitHub PR review on ${repository.fullName}${target.label}`
          : `Waiting for GitHub checks on ${repository.fullName}${target.label}`,
      },
    }, {
      onSuccess: () => {
        toastManager.add({
          type: 'success',
          title: sourceKind === 'github-review'
            ? 'GitHub review await created'
            : 'GitHub checks await created',
          description: `${repository.fullName}${target.label}`,
        })
      },
    })
  }

  const repositoryDetectionStatus = repositoriesQuery.isLoading
    || remotesQuery.isLoading
    ? 'loading'
    : repositoriesQuery.isError || remotesQuery.isError
      ? 'error'
      : 'ready'

  return {
    hasSession: !!sessionId,
    hasWorkspace: !!workspaceId,
    detectedRepository,
    detectedPullRequestNumber,
    repositoryDetectionStatus,
    isCreating: createMutation.isPending,
    onCreate: createAwait,
  }
}
