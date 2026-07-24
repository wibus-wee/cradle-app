import { useQueryClient } from '@tanstack/react-query'

import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { useBrowserPanelStore } from '~/store/browser-panel'

import { pullRequestQueryOptions } from './api/pull-requests'
import { PullRequestsPageView } from './pull-requests-page-view'
import type { CradlePullRequest } from './use-pull-requests'
import { useCradlePullRequests } from './use-pull-requests'

const PULL_REQUEST_LAYOUT_SLOTS = { hasBrowserPanel: true } as const

function isGitHubAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const record = error as { code?: unknown, error?: unknown }
  if (record.code === 'github_auth_required') {
    return true
  }
  return !!record.error
    && typeof record.error === 'object'
    && (record.error as { code?: unknown }).code === 'github_auth_required'
}

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
  const hasGitHubAuthError = isGitHubAuthError(error)

  useRegisterLayoutSlots('pull-requests', PULL_REQUEST_LAYOUT_SLOTS)

  if (error && !hasGitHubAuthError) {
    throw error
  }

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
      authRequired={hasGitHubAuthError}
      authoredFeed={authored}
      reviewingFeed={reviewing}
      selectedRef={selectedRef}
      onPrefetch={prefetchPullRequest}
      onSelect={selectPullRequest}
    />
  )
}
