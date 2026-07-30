import { useQueryClient } from '@tanstack/react-query'

import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { useBrowserPanelStore } from '~/store/browser-panel'

import { pullRequestQueryOptions } from './api/pull-requests'
import { resolvePullRequestErrorKind } from './pull-request-error'
import { PullRequestsPageView } from './pull-requests-page-view'
import type { CradlePullRequest } from './use-pull-requests'
import { useCradlePullRequests } from './use-pull-requests'

const PULL_REQUEST_LAYOUT_SLOTS = { hasBrowserPanel: true } as const

export interface PullRequestsPageProps {
  selectedRef?: string
  onSelectedRefChange: (ref?: string) => void
}

export function PullRequestsPage({
  selectedRef,
  onSelectedRefChange,
}: PullRequestsPageProps) {
  const queryClient = useQueryClient()
  const { entries, viewer, isPending, error, authored, reviewing } = useCradlePullRequests()
  const openPullRequestTab = useBrowserPanelStore(state => state.openPullRequestTab)
  const errorKind = error ? resolvePullRequestErrorKind(error) : null

  useRegisterLayoutSlots('pull-requests', PULL_REQUEST_LAYOUT_SLOTS)

  const prefetchPullRequest = (item: CradlePullRequest) => {
    void queryClient.prefetchQuery(pullRequestQueryOptions.detail({
      path: {
        owner: item.pullRequest.owner,
        repo: item.pullRequest.repo,
        number: String(item.pullRequest.number),
      },
    }))
  }

  const selectPullRequest = (item: CradlePullRequest) => {
    openPullRequestTab({
      owner: item.pullRequest.owner,
      repo: item.pullRequest.repo,
      number: item.pullRequest.number,
      workId: item.workId,
      sessionId: item.primarySessionId,
      title: item.pullRequest.title,
      ownerId: 'pull-requests',
    })
    onSelectedRefChange(item.id)
  }

  return (
    <PullRequestsPageView
      entries={entries}
      viewer={viewer}
      pending={isPending}
      errorKind={errorKind}
      retrying={Boolean(error && isPending)}
      onRetry={error
        ? () => {
            void queryClient.invalidateQueries({
              predicate: (query) => {
                const head = query.queryKey[0]
                if (typeof head !== 'object' || head === null || !('_id' in head)) {
                  return false
                }
                const id = (head as { _id?: unknown })._id
                return id === 'getPullRequestsViewer'
                  || id === 'getPullRequestsAuthored'
                  || id === 'getPullRequestsReviewing'
              },
            })
          }
        : undefined}
      authoredFeed={authored}
      reviewingFeed={reviewing}
      selectedRef={selectedRef}
      onPrefetch={prefetchPullRequest}
      onSelect={selectPullRequest}
    />
  )
}
