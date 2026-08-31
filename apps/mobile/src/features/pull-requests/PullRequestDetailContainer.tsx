import { useMutation, useQuery } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import { Stack } from 'expo-router'
import { Alert, Platform } from 'react-native'

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
  })

  if (query.isPending) {
    return <LoadingState />
  }
  if (query.error) {
    return (
      <ErrorState
        title="Could not open pull request"
        description={errorMessage(query.error)}
        isActionPending={query.isFetching}
        onAction={() => { void query.refetch() }}
      />
    )
  }
  const nativeHeader = Platform.OS !== 'web'
  return (
    <>
      <Stack.Screen options={{ title: `#${query.data.pullRequest.number}` }} />
      {nativeHeader && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            accessibilityHint="Opens this pull request on GitHub"
            accessibilityLabel="Open on GitHub"
            onPress={() => {
              void Linking.openURL(query.data.pullRequest.url).catch(() => {
                Alert.alert('Could not open pull request on GitHub')
              })
            }}
          >
            {Platform.OS === 'ios'
              ? (
                  <>
                    <Stack.Toolbar.Icon sf="safari" />
                    <Stack.Toolbar.Label>GitHub</Stack.Toolbar.Label>
                  </>
                )
              : 'GitHub'}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <PullRequestDetailView
        detail={query.data}
        isMutating={action.isPending}
        nativeHeader={nativeHeader}
        onComment={async (body) => {
          await action.mutateAsync({ endpoint: 'comment', body: { body } })
        }}
        onOpenExternal={async (url) => {
          await Linking.openURL(url)
        }}
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
