import { router } from '~/router'

import { WORKING_TREE_REVIEW_ID } from './types'

export interface DiffsViewSearch {
  workspace?: string
  repo?: string
  path?: string
  review?: string
  view?: 'commit' | 'guide'
  line?: number
  side?: 'base' | 'head'
}

function normalizeRepositoryPath(repositoryPath?: string | null): string | undefined {
  return repositoryPath && repositoryPath !== '.' ? repositoryPath : undefined
}

/**
 * Coerce a route search value (string from the URL, or number from in-memory navigation) into a
 * positive integer. Used by the diff route `validateSearch` schemas so `line` arrives typed.
 */
export function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return parsed > 0 ? parsed : undefined
  }
  return undefined
}

export function parseAnchorSide(value: unknown): 'base' | 'head' | undefined {
  return value === 'base' || value === 'head' ? value : undefined
}

function navigateWithinCurrentDiffSurface(input: {
  workspaceId: string
  repositoryPath?: string | null
  path?: string | null
  review?: string
  view?: 'commit' | 'guide'
  line?: number | null
  side?: 'base' | 'head' | null
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
        view: input.view,
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
      view: input.view,
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
 * Jump from a guide chapter (or anywhere with a file + line) into the review detail at that
 * anchor. Drops `view: 'guide'` so the review detail renders instead of the guide, and threads
 * `line`/`side` so DiffStage can scroll to the exact line on mount.
 */
export function navigateToReviewAtAnchor(
  workspaceId: string,
  reviewId: string,
  options: {
    repositoryPath?: string | null
    path: string
    line?: number
    side?: 'base' | 'head'
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

export function navigateToCommitView(workspaceId: string, reviewId: string, repositoryPath?: string | null): void {
  navigateWithinCurrentDiffSurface({
    workspaceId,
    repositoryPath,
    review: reviewId,
    view: 'commit',
  })
}

export function navigateToGuideView(workspaceId: string, reviewId: string, repositoryPath?: string | null): void {
  navigateWithinCurrentDiffSurface({
    workspaceId,
    repositoryPath,
    review: reviewId,
    view: 'guide',
  })
}

export { WORKING_TREE_REVIEW_ID }
