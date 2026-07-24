import {
  getPullRequestsAuthoredInfiniteOptions,
  getPullRequestsByOwnerByRepoByNumberDetailOptions,
  getPullRequestsReviewingInfiniteOptions,
  getPullRequestsViewerOptions,
  getWorksOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetPullRequestsAuthoredResponse,
  GetPullRequestsByOwnerByRepoByNumberDetailResponse,
} from '~/api-gen/types.gen'

export type PullRequestDetail = GetPullRequestsByOwnerByRepoByNumberDetailResponse
export type PullRequestView = GetPullRequestsAuthoredResponse['items'][number]

export const pullRequestQueryOptions = {
  authored: getPullRequestsAuthoredInfiniteOptions,
  detail: getPullRequestsByOwnerByRepoByNumberDetailOptions,
  reviewing: getPullRequestsReviewingInfiniteOptions,
  viewer: getPullRequestsViewerOptions,
  works: getWorksOptions,
} as const
