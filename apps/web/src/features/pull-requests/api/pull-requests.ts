import {
  getPullRequestsAuthoredInfiniteOptions,
  getPullRequestsByOwnerByRepoAssignableUsersOptions,
  getPullRequestsByOwnerByRepoByNumberDetailOptions,
  getPullRequestsByOwnerByRepoByNumberFingerprintOptions,
  getPullRequestsReviewingInfiniteOptions,
  getPullRequestsViewerOptions,
  getWorksOptions,
  postPullRequestsByOwnerByRepoByNumberAssigneesMutation,
  postPullRequestsByOwnerByRepoByNumberCommentMutation,
  postPullRequestsByOwnerByRepoByNumberDraftMutation,
  postPullRequestsByOwnerByRepoByNumberMergeMutation,
  postPullRequestsByOwnerByRepoByNumberReadyMutation,
  postPullRequestsByOwnerByRepoByNumberRefreshMutation,
  postPullRequestsByOwnerByRepoByNumberReviewersMutation,
  postPullRequestsByOwnerByRepoByNumberReviewMutation,
  postPullRequestsRefreshMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetPullRequestsAuthoredResponse,
  GetPullRequestsByOwnerByRepoByNumberDetailResponse,
  GetPullRequestsViewerResponse,
} from '~/api-gen/types.gen'

export type PullRequestDetail = GetPullRequestsByOwnerByRepoByNumberDetailResponse
export type PullRequestView = GetPullRequestsAuthoredResponse['items'][number]
export type PullRequestViewer = GetPullRequestsViewerResponse['viewer']

export const pullRequestQueryOptions = {
  assignableUsers: getPullRequestsByOwnerByRepoAssignableUsersOptions,
  authored: getPullRequestsAuthoredInfiniteOptions,
  detail: getPullRequestsByOwnerByRepoByNumberDetailOptions,
  fingerprint: getPullRequestsByOwnerByRepoByNumberFingerprintOptions,
  reviewing: getPullRequestsReviewingInfiniteOptions,
  viewer: getPullRequestsViewerOptions,
  works: getWorksOptions,
} as const

export const pullRequestMutations = {
  assignees: postPullRequestsByOwnerByRepoByNumberAssigneesMutation,
  comment: postPullRequestsByOwnerByRepoByNumberCommentMutation,
  draft: postPullRequestsByOwnerByRepoByNumberDraftMutation,
  merge: postPullRequestsByOwnerByRepoByNumberMergeMutation,
  ready: postPullRequestsByOwnerByRepoByNumberReadyMutation,
  refresh: postPullRequestsByOwnerByRepoByNumberRefreshMutation,
  review: postPullRequestsByOwnerByRepoByNumberReviewMutation,
  reviewers: postPullRequestsByOwnerByRepoByNumberReviewersMutation,
  refreshFeeds: postPullRequestsRefreshMutation,
} as const
