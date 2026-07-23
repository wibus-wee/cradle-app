import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getWorkspacesByWorkspaceIdDiffReviews } from '~/api-gen/sdk.gen'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

import { githubPullRequestReferenceKey } from '../github-pull-request-reference'
import { reviewForMe, reviewListQueryKey } from './diff-items'
import type { CradleDiffReview } from './types'

export type ReviewsListTab = 'for-me' | 'created' | 'all'

const EMPTY_GITHUB_ROLES = new Map<string, 'authored' | 'reviewing'>()

function matchesTab(
  review: CradleDiffReview,
  tab: ReviewsListTab,
  githubRolesByRef: ReadonlyMap<string, 'authored' | 'reviewing'>,
): boolean {
  if (review.githubPullRequest) {
    const role = githubRolesByRef.get(githubPullRequestReferenceKey(review.githubPullRequest))
    if (role) {
      return tab === 'all' || (tab === 'for-me' ? role === 'reviewing' : role === 'authored')
    }
  }
  if (tab === 'for-me') {
    return reviewForMe(review)
  }
  if (tab === 'created') {
    return review.sourceKind === 'local-working-tree'
      || review.sourceKind === 'local-branch-compare'
      || review.sourceKind === 'local-commit'
      || review.events.some(event => event.eventKind === 'review_created' && event.actorId === 'local-user')
  }
  return true
}

export function useReviewList(
  workspaceId: string,
  githubRolesByRef: ReadonlyMap<string, 'authored' | 'reviewing'> = EMPTY_GITHUB_ROLES,
) {
  const query = useQuery({
    queryKey: reviewListQueryKey(workspaceId),
    queryFn: async () => {
      const { data } = await getWorkspacesByWorkspaceIdDiffReviews({
        path: { workspaceId },
        throwOnError: true,
      })
      return data
    },
    ...queryRefreshPolicies.active,
    retry: false,
  })

  const reviews = useMemo(() => query.data ?? [], [query.data])

  const countForTab = useMemo(
    () => (tab: ReviewsListTab) => reviews.filter(review => matchesTab(review, tab, githubRolesByRef)).length,
    [githubRolesByRef, reviews],
  )

  const reviewsForTab = useMemo(
    () => (tab: ReviewsListTab): CradleDiffReview[] => reviews.filter(
      review => matchesTab(review, tab, githubRolesByRef),
    ),
    [githubRolesByRef, reviews],
  )

  return {
    reviews,
    isLoading: query.isLoading,
    isError: query.isError,
    countForTab,
    reviewsForTab,
  }
}
