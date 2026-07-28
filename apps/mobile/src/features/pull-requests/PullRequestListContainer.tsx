import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'

import type {
  GetPullRequestsAuthoredResponse,
  GetPullRequestsReviewingResponse,
  GetPullRequestsViewerResponse,
} from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

import { PullRequestListView } from './PullRequestListView'

export function PullRequestListContainer() {
  const { connection } = useConnection()
  const query = useQuery({
    enabled: Boolean(connection),
    queryKey: ['pull-requests', connection?.url],
    queryFn: async () => {
      const viewer = await cradleRequest<GetPullRequestsViewerResponse>(connection!, '/pull-requests/viewer')
      const login = encodeURIComponent(viewer.viewer.login)
      const [authored, reviewing] = await Promise.all([
        cradleRequest<GetPullRequestsAuthoredResponse>(connection!, `/pull-requests/authored?login=${login}`),
        cradleRequest<GetPullRequestsReviewingResponse>(connection!, `/pull-requests/reviewing?login=${login}`),
      ])
      return { login: viewer.viewer.login, authored: authored.items, reviewing: reviewing.items }
    },
    refetchInterval: 30_000,
  })

  if (query.isPending) { return <LoadingState /> }
  if (query.error) {
    return (
      <ErrorState
        title="GitHub is not available"
        description={`${errorMessage(query.error)} Configure GitHub access on Cradle Desktop.`}
      />
    )
  }
  return (
    <PullRequestListView
      {...query.data}
      isRefreshing={query.isRefetching}
      onOpen={pullRequest => router.push(
        `/pull-request/${pullRequest.owner}/${pullRequest.repo}/${pullRequest.number}`,
      )}
      onRefresh={() => void query.refetch()}
    />
  )
}
