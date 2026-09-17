import { router } from '~/router'

import type { DiffAnchorSide } from './search-params'
import { WORKING_TREE_REVIEW_ID } from './types'

function normalizeRepositoryPath(repositoryPath?: string | null): string | undefined {
  return repositoryPath && repositoryPath !== '.' ? repositoryPath : undefined
}

function navigateWithinCurrentDiffSurface(input: {
  workspaceId: string
  repositoryPath?: string | null
  path?: string | null
  review?: string
  line?: number | null
  side?: DiffAnchorSide | null
  replace?: boolean
}): void {
  const repo = normalizeRepositoryPath(input.repositoryPath)

  if (router.state.location.pathname === '/diff') {
    void router.navigate({
      to: '/diff',
      search: {
        workspace: input.workspaceId,
        repo,
        path: input.path ?? undefined,
        review: input.review,
        line: input.line ?? undefined,
        side: input.side ?? undefined,
      },
      replace: input.replace,
    })
    return
  }

  void router.navigate({
    to: '/workspaces/$workspaceId/diffs',
    params: { workspaceId: input.workspaceId },
    search: {
      repo,
      path: input.path ?? undefined,
      review: input.review,
      line: input.line ?? undefined,
      side: input.side ?? undefined,
    },
    replace: input.replace,
  })
}

export function navigateToReviewsList(workspaceId: string, repositoryPath?: string | null): void {
  navigateWithinCurrentDiffSurface({ workspaceId, repositoryPath })
}

export function navigateToReview(
  workspaceId: string,
  reviewId: string,
  options: { repositoryPath?: string | null, path?: string | null, replace?: boolean } = {},
): void {
  navigateWithinCurrentDiffSurface({
    workspaceId,
    repositoryPath: options.repositoryPath,
    path: options.path,
    review: reviewId,
    replace: options.replace,
  })
}

/**
 * Jump from a finding (or anywhere with a file + line) into the review detail at that
 * anchor. Threads `line`/`side` so DiffStage can scroll to the exact line on mount.
 */
export function navigateToReviewAtAnchor(
  workspaceId: string,
  reviewId: string,
  options: {
    repositoryPath?: string | null
    path: string
    line?: number
    side?: DiffAnchorSide
  },
): void {
  navigateWithinCurrentDiffSurface({
    workspaceId,
    repositoryPath: options.repositoryPath,
    path: options.path,
    review: reviewId,
    line: options.line,
    side: options.side,
  })
}

export { WORKING_TREE_REVIEW_ID }
