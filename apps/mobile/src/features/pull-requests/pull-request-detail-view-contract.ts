import type { GetPullRequestsByOwnerByRepoByNumberDetailResponse } from '@/api-gen'

import type { PullRequestReviewComposerProps } from './pull-request-review-composer-contract'

export interface PullRequestDetailViewProps extends PullRequestReviewComposerProps {
  detail: GetPullRequestsByOwnerByRepoByNumberDetailResponse
  nativeHeader?: boolean
  onOpenExternal: (url: string) => Promise<void>
}
