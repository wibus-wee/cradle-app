import { router } from '~/router'

import { WORKING_TREE_REVIEW_ID } from './types'

export interface DiffsViewSearch {
  workspace?: string
  repo?: string
  path?: string
  review?: string
  view?: 'commit' | 'guide'
}

function normalizeRepositoryPath(repositoryPath?: string | null): string | undefined {
  return repositoryPath && repositoryPath !== '.' ? repositoryPath : undefined
}

function navigateWithinCurrentDiffSurface(input: {
  workspaceId: string
  repositoryPath?: string | null
  path?: string | null
  review?: string
  view?: 'commit' | 'guide'
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
