import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router, Stack } from 'expo-router'

import type { GetWorksByIdResponse } from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

import type { WorkHandoff } from './WorkDetailView'
import { WorkDetailView } from './WorkDetailView'

export function WorkDetailContainer({ workId }: { workId: string }) {
  const { connection } = useConnection()
  const queryClient = useQueryClient()
  const query = useQuery({
    enabled: Boolean(connection),
    queryKey: ['work', connection?.url, workId],
    queryFn: () => cradleRequest<GetWorksByIdResponse>(connection!, `/works/${encodeURIComponent(workId)}`),
    refetchInterval: data => data.state.data?.activity === 'running' ? 2_000 : 10_000,
  })

  const prepare = useMutation({
    mutationFn: (handoff: WorkHandoff) => cradleRequest<GetWorksByIdResponse>(
      connection!,
      `/works/${encodeURIComponent(workId)}/prepare`,
      { method: 'POST', body: handoff },
    ),
    onSuccess: data => queryClient.setQueryData(['work', connection?.url, workId], data),
  })

  const submit = useMutation({
    mutationFn: (handoff: WorkHandoff) => cradleRequest<GetWorksByIdResponse>(
      connection!,
      `/works/${encodeURIComponent(workId)}/submit`,
      { method: 'POST', body: handoff },
    ),
    onSuccess: data => queryClient.setQueryData(['work', connection?.url, workId], data),
  })

  if (query.isPending) { return <LoadingState /> }
  if (query.error) { return <ErrorState title="Could not open Work" description={errorMessage(query.error)} /> }
  return (
    <>
      <Stack.Screen options={{ title: 'Work' }} />
      <WorkDetailView
        detail={query.data}
        isPreparing={prepare.isPending}
        isSubmitting={submit.isPending}
        onOpenChat={sessionId => router.push(`/session/${sessionId}`)}
        onOpenPullRequest={(owner, repo, number) => router.push(`/pull-request/${owner}/${repo}/${number}`)}
        onPrepare={handoff => prepare.mutate(handoff)}
        onSubmit={handoff => submit.mutate(handoff)}
      />
    </>
  )
}
