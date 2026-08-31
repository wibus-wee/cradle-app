import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'

import type {
  GetPullRequestsAuthoredResponse,
  GetPullRequestsReviewingResponse,
  GetPullRequestsViewerResponse,
} from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'

import { PullRequestListView } from './PullRequestListView'

interface PullRequestListContainerProps {
  onSearchQueryChange: (query: string) => void
  searchQuery: string
  showsInlineSearch: boolean
}

export function PullRequestListContainer({
  onSearchQueryChange,
  searchQuery,
  showsInlineSearch,
}: PullRequestListContainerProps) {
  const { connection } = useConnection()
  const isRouteActive = useRouteIsActive()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const query = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['pull-requests', connection?.url],
    queryFn: async ({ signal }) => {
      const viewer = await cradleRequest<GetPullRequestsViewerResponse>(
        connection!,
        '/pull-requests/viewer',
        { signal },
      )
      const login = encodeURIComponent(viewer.viewer.login)
      const [authored, reviewing] = await Promise.all([
        cradleRequest<GetPullRequestsAuthoredResponse>(
          connection!,
          `/pull-requests/authored?login=${login}`,
          { signal },
        ),
        cradleRequest<GetPullRequestsReviewingResponse>(
          connection!,
          `/pull-requests/reviewing?login=${login}`,
          { signal },
        ),
      ])
      return { login: viewer.viewer.login, authored: authored.items, reviewing: reviewing.items }
    },
  })

  const refresh = async () => {
    setIsRefreshing(true)
    try {
      await query.refetch()
    }
    finally {
      setIsRefreshing(false)
    }
  }

  if (query.isPending) {
    return <LoadingState />
  }
  if (query.error) {
    return (
      <ErrorState
        title="GitHub is not available"
        description={`${errorMessage(query.error)} Configure GitHub access on Cradle Desktop.`}
        isActionPending={query.isFetching}
        onAction={() => { void query.refetch() }}
      />
    )
  }
  return (
    <PullRequestListView
      {...query.data}
      isRefreshing={isRefreshing}
      onOpen={pullRequest =>
        router.push(`/pull-request/${pullRequest.owner}/${pullRequest.repo}/${pullRequest.number}`)}
      onOpenUsage={() => router.push('/usage')}
      onRefresh={refresh}
      onSearchQueryChange={onSearchQueryChange}
      searchQuery={searchQuery}
      showsInlineSearch={showsInlineSearch}
    />
  )
}
