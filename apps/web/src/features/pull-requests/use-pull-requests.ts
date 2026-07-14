import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { WorkSummary } from '~/features/work/use-work'

import type { PullRequestView } from './api/pull-requests'
import { pullRequestQueryOptions } from './api/pull-requests'

export type { PullRequestView } from './api/pull-requests'
export type PullRequestRole = 'authored' | 'reviewing'

/**
 * A pull request the viewer is involved in on GitHub, with an optional
 * Cradle Work overlay when Cradle happens to have created/bound it. `role`
 * reflects the viewer's relationship to the PR (author vs requested
 * reviewer), matching the "全部/正在审查/由我创建" filter semantics - it is
 * independent of the PR's lifecycle state (draft/ready/merged/closed).
 */
export interface CradlePullRequest {
  id: string
  role: PullRequestRole
  pullRequest: PullRequestView
  workId?: string
  primarySessionId?: string
}

/**
 * One role's paginated feed, as exposed to the page component so it can
 * render a "Load more" affordance without knowing about GitHub search
 * cursors - `/pull-requests/authored` and `/pull-requests/reviewing` do not
 * cap results server-side, so a viewer with a long history pages through
 * all of it rather than having the tail silently dropped.
 */
export interface PullRequestFeedPage {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
}

function pullRequestRefKey(pullRequest: { owner: string, repo: string, number: number }): string {
  return `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`
}

function indexWorksByPullRequestRef(works: WorkSummary[]): Map<string, WorkSummary> {
  const index = new Map<string, WorkSummary>()
  for (const work of works) {
    if (work.pullRequest) {
      index.set(pullRequestRefKey(work.pullRequest), work)
    }
  }
  return index
}

function toEntries(
  pullRequests: PullRequestView[],
  role: PullRequestRole,
  workByRef: Map<string, WorkSummary>,
): CradlePullRequest[] {
  return pullRequests.map((pullRequest) => {
    const work = workByRef.get(pullRequestRefKey(pullRequest))
    return {
      id: pullRequestRefKey(pullRequest),
      role,
      pullRequest,
      workId: work?.id,
      primarySessionId: work?.primarySessionId,
    }
  })
}

/**
 * All pull requests the viewer authored or is requested to review, across
 * every GitHub repository - not just ones Cradle created. A PR authored by
 * the viewer that also requests their review is listed once, under
 * "authored" (see pull-requests-page.tsx role filtering).
 *
 * Each role is its own cursor-paginated feed (see pull-request module
 * README): `entries` holds every page fetched so far, and `authored`/
 * `reviewing` expose `hasNextPage`/`fetchNextPage` so the page component can
 * offer "Load more" per role without a hidden item cap.
 */
export function useCradlePullRequests() {
  const viewerQuery = useQuery({
    ...pullRequestQueryOptions.viewer(),
    staleTime: 5 * 60_000,
  })
  const login = viewerQuery.data?.viewer.login

  const authoredQuery = useInfiniteQuery({
    ...pullRequestQueryOptions.authored({ query: { login: login ?? '' } }),
    // '' (not undefined) satisfies the generated cursor param's `string` type;
    // the server treats an empty `after` the same as "no cursor" (first page).
    initialPageParam: '',
    getNextPageParam: lastPage => (lastPage.hasNextPage ? lastPage.endCursor ?? undefined : undefined),
    enabled: !!login,
    staleTime: 30_000,
  })
  const reviewingQuery = useInfiniteQuery({
    ...pullRequestQueryOptions.reviewing({ query: { login: login ?? '' } }),
    initialPageParam: '',
    getNextPageParam: lastPage => (lastPage.hasNextPage ? lastPage.endCursor ?? undefined : undefined),
    enabled: !!login,
    staleTime: 30_000,
  })
  const workQuery = useQuery({
    ...pullRequestQueryOptions.works(),
    staleTime: 5_000,
    refetchInterval: 15_000,
  })

  const entries = useMemo(() => {
    const authoredItems = authoredQuery.data?.pages.flatMap(page => page.items) ?? []
    const reviewingItems = reviewingQuery.data?.pages.flatMap(page => page.items) ?? []
    const workByRef = indexWorksByPullRequestRef(workQuery.data ?? [])
    const authored = toEntries(authoredItems, 'authored', workByRef)
    const authoredRefs = new Set(authored.map(entry => entry.id))
    const reviewing = toEntries(
      reviewingItems.filter(pullRequest => !authoredRefs.has(pullRequestRefKey(pullRequest))),
      'reviewing',
      workByRef,
    )
    return [...authored, ...reviewing]
  }, [authoredQuery.data, reviewingQuery.data, workQuery.data])

  return {
    entries,
    viewer: viewerQuery.data?.viewer ?? null,
    isPending: viewerQuery.isPending || (!!login && (authoredQuery.isPending || reviewingQuery.isPending)),
    error: viewerQuery.error ?? authoredQuery.error ?? reviewingQuery.error,
    authored: {
      hasNextPage: authoredQuery.hasNextPage,
      isFetchingNextPage: authoredQuery.isFetchingNextPage,
      fetchNextPage: () => void authoredQuery.fetchNextPage(),
    } satisfies PullRequestFeedPage,
    reviewing: {
      hasNextPage: reviewingQuery.hasNextPage,
      isFetchingNextPage: reviewingQuery.isFetchingNextPage,
      fetchNextPage: () => void reviewingQuery.fetchNextPage(),
    } satisfies PullRequestFeedPage,
  }
}
