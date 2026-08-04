import { useMutation, useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'

import type { GetPullRequestsByOwnerByRepoByNumberDetailResponse } from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

import { PullRequestDetailView } from './PullRequestDetailView'

interface PullRequestDetailContainerProps {
  owner: string
  repo: string
  number: string
}

export function PullRequestDetailContainer({ owner, repo, number }: PullRequestDetailContainerProps) {
  const { connection } = useConnection()
  const path = `/pull-requests/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`
  const query = useQuery({
    enabled: Boolean(connection),
    queryKey: ['pull-request', connection?.url, owner, repo, number],
    queryFn: () => cradleRequest<GetPullRequestsByOwnerByRepoByNumberDetailResponse>(connection!, `${path}/detail`),
    refetchInterval: data => data.state.data?.pullRequest.checksState === 'pending' ? 5_000 : 30_000,
  })

  const action = useMutation({
    mutationFn: ({ endpoint, body }: { endpoint: string, body: object }) => cradleRequest(
      connection!,
      `${path}/${endpoint}`,
      { method: 'POST', body },
    ),
    onSuccess: () => void query.refetch(),
  })

  if (query.isPending) { return <LoadingState /> }
  if (query.error) { return <ErrorState title="Could not open pull request" description={errorMessage(query.error)} /> }
  return (
    <>
      <Stack.Screen options={{ title: `#${query.data.pullRequest.number}` }} />
      <PullRequestDetailView
        detail={query.data}
        isMutating={action.isPending}
        onComment={body => action.mutate({ endpoint: 'comment', body: { body } })}
        onReview={(event, body) => action.mutate({
          endpoint: 'review',
          body: { event, ...(body ? { body } : {}) },
        })}
      />
    </>
  )
}
