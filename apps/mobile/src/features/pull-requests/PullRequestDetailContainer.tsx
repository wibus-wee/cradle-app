import { useMutation, useQuery } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import { Stack } from 'expo-router'

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
      <ErrorState title="Could not open pull request" description={errorMessage(query.error)} />
    )
  }
  return (
    <>
      <Stack.Screen options={{ title: `#${query.data.pullRequest.number}` }} />
      <PullRequestDetailView
        detail={query.data}
        isMutating={action.isPending}
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
