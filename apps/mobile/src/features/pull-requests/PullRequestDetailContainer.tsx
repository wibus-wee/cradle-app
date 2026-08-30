import { useMutation, useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, Linking } from 'react-native'

import type { GetPullRequestsByOwnerByRepoByNumberDetailResponse } from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'

import { PullRequestDetailView } from './PullRequestDetailView'

interface PullRequestDetailContainerProps {
  owner: string
  repo: string
  number: string
}

export function PullRequestDetailContainer({
  owner,
  repo,
  number,
}: PullRequestDetailContainerProps) {
  const { connection } = useConnection()
  const isRouteActive = useRouteIsActive()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const path = `/pull-requests/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`
  const query = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['pull-request', connection?.url, owner, repo, number],
    queryFn: ({ signal }) =>
      cradleRequest<GetPullRequestsByOwnerByRepoByNumberDetailResponse>(
        connection!,
        `${path}/detail`,
        { signal },
      ),
    refetchInterval: data =>
      data.state.data?.pullRequest.checksState === 'pending' ? 10_000 : false,
  })

  const action = useMutation({
    mutationFn: ({ endpoint, body }: { endpoint: string, body: object }) =>
      cradleRequest(connection!, `${path}/${endpoint}`, { method: 'POST', body }),
    onSuccess: () => void query.refetch(),
    onError: (error, variables) => {
      Alert.alert(
        variables.endpoint === 'comment' ? 'Could not post comment' : 'Could not submit review',
        errorMessage(error),
      )
    },
  })

  const refresh = () => {
    if (!connection) {
      return
    }
    setIsRefreshing(true)
    void cradleRequest(connection, `${path}/refresh`, {
      method: 'POST',
      body: { force: true },
    })
      .then(() => query.refetch())
      .catch((error: Error) => {
        Alert.alert('Could not refresh pull request', errorMessage(error))
      })
      .finally(() => setIsRefreshing(false))
  }

  if (query.isPending) {
    return <LoadingState />
  }
  if (query.error) {
    return (
      <ErrorState
        title="Could not open pull request"
        description={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }

  const openExternalUrl = (url: string, title: string) => {
    void Linking.openURL(url).catch(() => {
      Alert.alert(title, 'The GitHub link could not be opened on this device.')
    })
  }

  return (
    <>
      <Stack.Screen options={{ title: `#${query.data.pullRequest.number}` }} />
      <PullRequestDetailView
        detail={query.data}
        isMutating={action.isPending}
        isRefreshing={isRefreshing}
        onComment={async (body) => {
          await action.mutateAsync({ endpoint: 'comment', body: { body } })
        }}
        onOpenCheck={url => openExternalUrl(url, 'Could not open check')}
        onOpenExternal={() => openExternalUrl(query.data.pullRequest.url, 'Could not open pull request')}
        onRefresh={refresh}
        onReview={async (event, body) => {
          await action.mutateAsync({
            endpoint: 'review',
            body: { event, ...(body ? { body } : {}) },
          })
        }}
      />
    </>
  )
}
