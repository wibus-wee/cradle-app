import type {
  GetPullRequestsAuthoredResponse,
  GetPullRequestsReviewingResponse,
} from '@/api-gen'

export type PullRequestListItem = GetPullRequestsAuthoredResponse['items'][number]

export interface PullRequestListViewProps {
  authored: GetPullRequestsAuthoredResponse['items']
  reviewing: GetPullRequestsReviewingResponse['items']
  login: string
  isRefreshing?: boolean
  onOpen: (pullRequest: PullRequestListItem) => void
  onOpenUsage: () => void
  onRefresh?: () => Promise<void> | void
  onSearchQueryChange: (query: string) => void
  searchQuery: string
  showsInlineSearch?: boolean
}
