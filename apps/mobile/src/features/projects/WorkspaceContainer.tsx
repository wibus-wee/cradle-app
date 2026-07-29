import { useQuery } from '@tanstack/react-query'
import { router, Stack } from 'expo-router'
import { useState } from 'react'

import type {
  GetSessionsResponse,
  GetWorkspacesByWorkspaceIdFilesChildrenResponse,
  GetWorkspacesResponse,
  GetWorksResponse,
} from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

import { WorkspaceView } from './WorkspaceView'

export function WorkspaceContainer({ workspaceId }: { workspaceId: string }) {
  const { connection } = useConnection()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const query = useQuery({
    enabled: Boolean(connection),
    queryKey: ['workspace', connection?.url, workspaceId],
    queryFn: async () => {
      const [workspaces, sessions, works, files] = await Promise.all([
        cradleRequest<GetWorkspacesResponse>(connection!, '/workspaces'),
        cradleRequest<GetSessionsResponse>(connection!, `/sessions/?workspaceId=${encodeURIComponent(workspaceId)}&archived=false`),
        cradleRequest<GetWorksResponse>(connection!, `/works?workspaceId=${encodeURIComponent(workspaceId)}&archived=false`),
        cradleRequest<GetWorkspacesByWorkspaceIdFilesChildrenResponse>(
          connection!,
          `/workspaces/${encodeURIComponent(workspaceId)}/files/children`,
        ),
      ])
      const workspace = workspaces.find(candidate => candidate.id === workspaceId)
      if (!workspace) {
        throw new Error('Workspace not found')
      }
      return { workspace, sessions, works, files }
    },
    refetchInterval: data => (
      data.state.data?.sessions.some(session => session.status === 'streaming')
      || data.state.data?.works.some(work => work.activity === 'running')
    )
? 2_000
: 15_000,
  })

  const refresh = async () => {
    setIsRefreshing(true)
    try {
      await query.refetch()
    }
    finally {
      setIsRefreshing(false)
    }
  }

  if (query.isPending) { return <LoadingState /> }
  if (query.error) { return <ErrorState title="Could not open project" description={errorMessage(query.error)} /> }
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <WorkspaceView
        {...query.data}
        isRefreshing={isRefreshing}
        onOpenSession={sessionId => router.push(`/session/${sessionId}`)}
        onOpenWork={workId => router.push(`/work/${workId}`)}
        onRefresh={() => void refresh()}
      />
    </>
  )
}
