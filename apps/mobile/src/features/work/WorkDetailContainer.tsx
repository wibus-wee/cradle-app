import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router, Stack } from 'expo-router'

import type { GetWorksByIdResponse } from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'

import type { WorkHandoff } from './WorkDetailView'
import { WorkDetailView } from './WorkDetailView'

export function WorkDetailContainer({ workId }: { workId: string }) {
  const { connection } = useConnection()
  const isRouteActive = useRouteIsActive()
  const queryClient = useQueryClient()
  const query = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['work', connection?.url, workId],
    queryFn: ({ signal }) =>
      cradleRequest<GetWorksByIdResponse>(connection!, `/works/${encodeURIComponent(workId)}`, {
        signal,
      }),
    refetchInterval: data => (data.state.data?.activity === 'running' ? 5_000 : false),
  })

  const prepare = useMutation({
    mutationFn: (handoff: WorkHandoff) =>
      cradleRequest<GetWorksByIdResponse>(
        connection!,
        `/works/${encodeURIComponent(workId)}/prepare`,
        { method: 'POST', body: handoff },
      ),
    onSuccess: data => queryClient.setQueryData(['work', connection?.url, workId], data),
  })

  const submit = useMutation({
    mutationFn: (handoff: WorkHandoff) =>
      cradleRequest<GetWorksByIdResponse>(
        connection!,
        `/works/${encodeURIComponent(workId)}/submit`,
        { method: 'POST', body: handoff },
      ),
    onSuccess: data => queryClient.setQueryData(['work', connection?.url, workId], data),
  })

  if (query.isPending) {
    return <LoadingState />
  }
  if (query.error) {
    return (
      <ErrorState
        title="Could not open Work"
        description={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }
  return (
    <>
      <Stack.Screen options={{ title: 'Work info' }} />
      <WorkDetailView
        detail={query.data}
        isPreparing={prepare.isPending}
        isSubmitting={submit.isPending}
        onOpenPullRequest={(owner, repo, number) =>
          router.push(`/pull-request/${owner}/${repo}/${number}`)}
        onPrepare={handoff => prepare.mutate(handoff)}
        onSubmit={handoff => submit.mutate(handoff)}
      />
    </>
  )
}
