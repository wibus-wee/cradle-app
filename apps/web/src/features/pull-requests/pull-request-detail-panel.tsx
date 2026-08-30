import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import {
  getPullRequestsByOwnerByRepoByNumberDetailQueryKey,
  getPullRequestsByOwnerByRepoByNumberFingerprintQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'
import { apiErrorMessage } from '~/lib/api-error'
import { openWork } from '~/navigation/navigation-commands'

import { pullRequestMutations, pullRequestQueryOptions } from './api/pull-requests'
import { PullRequestDetailPanelView } from './pull-request-detail-panel-view'
import { resolvePullRequestErrorKind } from './pull-request-error'
import type { PullRequestActionsPending } from './pull-request-summary-view'
import { usePullRequestFingerprintSync } from './use-pull-request-fingerprint-sync'

export interface PullRequestDetailPanelProps {
  owner: string
  repo: string
  number: number
  workId?: string
}

/** Detail freshness is owned by fingerprint probe + mutate invalidation, not polling. */
const DETAIL_STALE_TIME_MS = Number.POSITIVE_INFINITY

export function PullRequestDetailPanel({
  owner,
  repo,
  number,
  workId,
}: PullRequestDetailPanelProps) {
  const { i18n, t } = useTranslation('pull-requests')
  const queryClient = useQueryClient()
  const path = { owner, repo, number: String(number) }

  const detailQuery = useQuery({
    ...pullRequestQueryOptions.detail({ path }),
    staleTime: DETAIL_STALE_TIME_MS,
  })

  const assignableUsersQuery = useQuery({
    ...pullRequestQueryOptions.assignableUsers({ path: { owner, repo } }),
    staleTime: DETAIL_STALE_TIME_MS,
  })

  const { resetFingerprint } = usePullRequestFingerprintSync({
    owner,
    repo,
    number,
    enabled: Boolean(detailQuery.data),
  })

  async function invalidatePullRequest() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getPullRequestsByOwnerByRepoByNumberDetailQueryKey({ path }),
      }),
      queryClient.invalidateQueries({
        queryKey: getPullRequestsByOwnerByRepoByNumberFingerprintQueryKey({ path }),
      }),
      queryClient.invalidateQueries({
        predicate: (query) => {
          const head = query.queryKey[0]
          if (typeof head !== 'object' || head === null || !('_id' in head)) {
            return false
          }
          const id = (head as { _id?: unknown })._id
          return id === 'getPullRequestsAuthored' || id === 'getPullRequestsReviewing'
        },
      }),
    ])
    await resetFingerprint()
  }

  function reportError(error: unknown) {
    toastManager.add({
      type: 'error',
      title: t('console.toast.error'),
      description: apiErrorMessage(error),
    })
  }

  const refreshMutation = useMutation({
    ...pullRequestMutations.refresh(),
    onSuccess: async (detail) => {
      queryClient.setQueryData(
        getPullRequestsByOwnerByRepoByNumberDetailQueryKey({ path }),
        detail,
      )
      await resetFingerprint()
    },
    onError: reportError,
  })

  const commentMutation = useMutation({
    ...pullRequestMutations.comment(),
    onSuccess: async () => {
      toastManager.add({ type: 'success', title: t('console.toast.comment') })
      await invalidatePullRequest()
    },
    onError: reportError,
  })

  const reviewMutation = useMutation({
    ...pullRequestMutations.review(),
    onSuccess: async () => {
      toastManager.add({ type: 'success', title: t('console.toast.review') })
      await invalidatePullRequest()
    },
    onError: reportError,
  })

  const mergeMutation = useMutation({
    ...pullRequestMutations.merge(),
    onSuccess: async () => {
      toastManager.add({ type: 'success', title: t('console.toast.merge') })
      await invalidatePullRequest()
    },
    onError: reportError,
  })

  const readyMutation = useMutation({
    ...pullRequestMutations.ready(),
    onSuccess: async () => {
      toastManager.add({ type: 'success', title: t('console.toast.ready') })
      await invalidatePullRequest()
    },
    onError: reportError,
  })

  const draftMutation = useMutation({
    ...pullRequestMutations.draft(),
    onSuccess: async () => {
      toastManager.add({ type: 'success', title: t('console.toast.draft') })
      await invalidatePullRequest()
    },
    onError: reportError,
  })

  const assigneesMutation = useMutation({
    ...pullRequestMutations.assignees(),
    onSuccess: async () => {
      toastManager.add({ type: 'success', title: t('console.toast.assignees') })
      await invalidatePullRequest()
    },
    onError: reportError,
  })

  const reviewersMutation = useMutation({
    ...pullRequestMutations.reviewers(),
    onSuccess: async () => {
      toastManager.add({ type: 'success', title: t('console.toast.reviewers') })
      await invalidatePullRequest()
    },
    onError: reportError,
  })

  const pending: PullRequestActionsPending = {
    comment: commentMutation.isPending,
    review: reviewMutation.isPending,
    merge: mergeMutation.isPending,
    readyDraft: readyMutation.isPending || draftMutation.isPending,
    assignees: assigneesMutation.isPending,
    reviewers: reviewersMutation.isPending,
  }

  if (detailQuery.error) {
    return (
      <PullRequestDetailPanelView
        detail={null}
        owner={owner}
        repo={repo}
        number={number}
        locale={i18n.language}
        isFetching={detailQuery.isFetching || refreshMutation.isPending}
        errorKind={resolvePullRequestErrorKind(detailQuery.error)}
        onRefresh={() => refreshMutation.mutate({ path, body: { force: true } })}
        onCopyLink={url => navigator.clipboard.writeText(url)}
        onOpenWork={workId ? () => openWork(workId) : undefined}
      />
    )
  }

  return (
    <PullRequestDetailPanelView
      detail={detailQuery.data ?? null}
      owner={owner}
      repo={repo}
      number={number}
      locale={i18n.language}
      isFetching={detailQuery.isFetching || refreshMutation.isPending}
      errorKind={null}
      onRefresh={() => refreshMutation.mutate({ path, body: { force: true } })}
      onCopyLink={url => navigator.clipboard.writeText(url)}
      onOpenWork={workId ? () => openWork(workId) : undefined}
      actions={detailQuery.data
        ? {
            pullRequest: detailQuery.data.pullRequest,
            assignableUsers: assignableUsersQuery.data?.users ?? [],
            pending,
            onComment: (body) => {
              commentMutation.mutate({ path, body: { body } })
            },
            onReview: (event, body) => {
              reviewMutation.mutate({
                path,
                body: body ? { event, body } : { event },
              })
            },
            onMerge: (mergeMethod, commit) => {
              mergeMutation.mutate({
                path,
                body: {
                  mergeMethod,
                  ...(commit?.title ? { commitTitle: commit.title } : {}),
                  ...(commit?.message ? { commitMessage: commit.message } : {}),
                },
              })
            },
            onToggleReadyDraft: () => {
              if (detailQuery.data?.pullRequest.isDraft) {
                readyMutation.mutate({ path })
                return
              }
              draftMutation.mutate({ path })
            },
            onAddAssignee: (login) => {
              assigneesMutation.mutate({ path, body: { add: [login] } })
            },
            onRemoveAssignee: (login) => {
              assigneesMutation.mutate({ path, body: { remove: [login] } })
            },
            onAddReviewer: (login) => {
              reviewersMutation.mutate({ path, body: { add: [login] } })
            },
            onRemoveReviewer: (login) => {
              reviewersMutation.mutate({ path, body: { remove: [login] } })
            },
          }
        : undefined}
    />
  )
}
