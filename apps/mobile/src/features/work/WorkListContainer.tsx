import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'

import type { GetWorkspacesResponse, GetWorksResponse, PostWorksResponse } from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

import type { CreateWorkInput } from './WorkListView'
import { WorkListView } from './WorkListView'

export function WorkListContainer() {
  const { connection } = useConnection()
  const queryClient = useQueryClient()
  const query = useQuery({
    enabled: Boolean(connection),
    queryKey: ['works', connection?.url],
    queryFn: async () => {
      const [works, workspaces] = await Promise.all([
        cradleRequest<GetWorksResponse>(connection!, '/works?archived=false'),
        cradleRequest<GetWorkspacesResponse>(connection!, '/workspaces'),
      ])
      return {
        works: works.sort((a, b) => b.updatedAt - a.updatedAt),
        workspaces: workspaces.filter(workspace =>
          workspace.availability === 'available' && workspace.locator.kind !== 'managed-worktree'),
      }
    },
    refetchInterval: data => data.state.data?.works.some(work => work.activity === 'running') ? 2_000 : 12_000,
  })

  const create = useMutation({
    mutationFn: (input: CreateWorkInput) => cradleRequest<PostWorksResponse>(
      connection!,
      '/works',
      {
        method: 'POST',
        body: {
          workspaceId: input.workspaceId,
          title: input.title,
          objective: input.objective || input.title,
          baseStrategy: 'source-head',
        },
      },
    ),
    onSuccess: (work) => {
      void queryClient.invalidateQueries({ queryKey: ['works', connection?.url] })
      router.push(`/work/${work.work.id}`)
    },
  })

  if (query.isPending) { return <LoadingState /> }
  if (query.error) { return <ErrorState title="Could not load Work" description={errorMessage(query.error)} /> }
  return (
    <WorkListView
      isCreating={create.isPending}
      isRefreshing={query.isRefetching}
      onCreate={input => create.mutate(input)}
      onOpen={workId => router.push(`/work/${workId}`)}
      onRefresh={() => void query.refetch()}
      {...query.data}
    />
  )
}
