import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getWorkspacesByWorkspaceIdDiffReviews } from '~/api-gen/sdk.gen'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

import { reviewForMe, reviewListQueryKey, sourceLabel } from './diff-items'
import type { CradleDiffReview, ReviewSourceKind } from './types'

export type ReviewsListTab = 'for-me' | 'created' | 'all'

export interface ReviewListGroup {
  id: string
  label: string
  reviews: CradleDiffReview[]
}

function groupSourceLabel(sourceKind: ReviewSourceKind): string {
  if (sourceKind === 'local-working-tree') {
    return 'Working tree reviews'
  }
  if (sourceKind === 'local-branch-compare') {
    return 'Branch comparisons'
  }
  if (sourceKind === 'local-commit') {
    return 'Commit diffs'
  }
  if (sourceKind === 'agent-change-set') {
    return 'Agent change sets'
  }
  if (sourceKind === 'github-pull-request') {
    return 'GitHub pull requests'
  }
  return `${sourceLabel(sourceKind)} reviews`
}

function statusLabel(status: CradleDiffReview['status']): string {
  if (status === 'open') {
    return ''
  }
  if (status === 'merged') {
    return 'Merged'
  }
  if (status === 'closed') {
    return 'Closed'
  }
  return 'Abandoned'
}

function groupLabel(sourceKind: ReviewSourceKind, status: CradleDiffReview['status']): string {
  const label = groupSourceLabel(sourceKind)
  const statusPrefix = statusLabel(status)
  return statusPrefix ? `${statusPrefix} ${label.toLowerCase()}` : label
}

function matchesTab(review: CradleDiffReview, tab: ReviewsListTab): boolean {
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

export function useReviewList(workspaceId: string) {
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
    () => (tab: ReviewsListTab) => reviews.filter(review => matchesTab(review, tab)).length,
    [reviews],
  )

  /** Group reviews for a given tab by `sourceKind:status`. */
  const groupsForTab = useMemo(
    () => (tab: ReviewsListTab): ReviewListGroup[] => {
      const grouped = new Map<string, ReviewListGroup>()
      for (const review of reviews) {
        if (!matchesTab(review, tab)) {
          continue
        }
        const groupKey = `${review.sourceKind}:${review.status}`
        const group = grouped.get(groupKey) ?? {
          id: groupKey,
          label: groupLabel(review.sourceKind, review.status),
          reviews: [],
        }
        group.reviews.push(review)
        grouped.set(groupKey, group)
      }
      return Array.from(grouped.values())
    },
    [reviews],
  )

  return {
    reviews,
    isLoading: query.isLoading,
    isError: query.isError,
    countForTab,
    groupsForTab,
  }
}
