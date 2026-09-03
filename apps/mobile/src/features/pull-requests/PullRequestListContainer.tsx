import { useQuery } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Share } from 'react-native'

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
    queryKey: ['pull-requests', connection?.resourceId],
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
      const login = query.data?.login
      if (login) {
        await cradleRequest(connection!, '/pull-requests/refresh', {
          body: { login },
          method: 'POST',
        })
      }
      await query.refetch({ throwOnError: true })
    }
    catch {
      Alert.alert(
        'Could not refresh pull requests',
        'Cradle could not sync the latest GitHub inbox.',
      )
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
      onOpenExternal={async (pullRequest) => {
        try {
          await Linking.openURL(pullRequest.url)
        }
        catch {
          Alert.alert('Could not open pull request on GitHub')
        }
      }}
      onOpenUsage={() => router.push('/usage')}
      onRefresh={refresh}
      onSearchQueryChange={onSearchQueryChange}
      onShare={async (pullRequest) => {
        try {
          await Share.share({
            message: pullRequest.title,
            title: pullRequest.title,
            url: pullRequest.url,
          })
        }
        catch {
          Alert.alert('Could not share pull request')
        }
      }}
      searchQuery={searchQuery}
      showsInlineSearch={showsInlineSearch}
    />
  )
}
