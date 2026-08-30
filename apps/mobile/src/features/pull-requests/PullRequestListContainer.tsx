import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert } from 'react-native'

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

export function PullRequestListContainer() {
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

  const refresh = () => {
    if (!connection || !query.data) {
      return
    }
    setIsRefreshing(true)
    void cradleRequest(connection, '/pull-requests/refresh', {
      method: 'POST',
      body: { login: query.data.login },
    })
      .then(() => query.refetch())
      .catch((error: Error) => {
        Alert.alert('Could not refresh pull requests', errorMessage(error))
      })
      .finally(() => setIsRefreshing(false))
  }

  if (query.isPending) {
    return <LoadingState />
  }
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
      isRefreshing={isRefreshing}
      onNavigate={section => router.replace(`/(tabs)/${section}`)}
      onOpen={pullRequest =>
        router.push(`/pull-request/${pullRequest.owner}/${pullRequest.repo}/${pullRequest.number}`)}
      onOpenUsage={() => router.push('/usage')}
      onRefresh={refresh}
    />
  )
}
