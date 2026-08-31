import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router, Stack } from 'expo-router'
import { Platform } from 'react-native'

import type { GetWorksByIdResponse } from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'

import type { WorkHandoff } from './work-detail-view-contract'
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
        isActionPending={query.isFetching}
        onAction={() => { void query.refetch() }}
      />
    )
  }
  return (
    <>
      <Stack.Screen options={{ title: 'Work info' }} />
      {Platform.OS === 'ios' && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            accessibilityHint="Opens the primary conversation for this Work"
            accessibilityLabel="Open Work conversation"
            onPress={() => router.push(`/session/${query.data.primaryThread.id}`)}
          >
            <Stack.Toolbar.Icon sf="message" />
            <Stack.Toolbar.Label>Conversation</Stack.Toolbar.Label>
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <WorkDetailView
        detail={query.data}
        isPreparing={prepare.isPending}
        isSubmitting={submit.isPending}
        onOpenPullRequest={(owner, repo, number) =>
          router.push(`/pull-request/${owner}/${repo}/${number}`)}
        onPrepare={async (handoff) => {
          await prepare.mutateAsync(handoff)
        }}
        onSubmit={async (handoff) => {
          await submit.mutateAsync(handoff)
        }}
      />
    </>
  )
}
