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
import { useCreateWork } from '@/features/work/use-create-work'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'
import { useSessionSummaryEvents } from '@/lib/use-session-summary-events'

import { WorkspaceView } from './WorkspaceView'

export function WorkspaceContainer({ workspaceId }: { workspaceId: string }) {
  const { connection } = useConnection()
  const create = useCreateWork()
  const isRouteActive = useRouteIsActive()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const query = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['workspace', connection?.url, workspaceId],
    queryFn: async ({ signal }) => {
      const [workspaces, sessions, works, files] = await Promise.all([
        cradleRequest<GetWorkspacesResponse>(connection!, '/workspaces', { signal }),
        cradleRequest<GetSessionsResponse>(
          connection!,
          `/sessions/?workspaceId=${encodeURIComponent(workspaceId)}&archived=false&limit=200`,
          { signal },
        ),
        cradleRequest<GetWorksResponse>(
          connection!,
          `/works?workspaceId=${encodeURIComponent(workspaceId)}&archived=false&limit=200`,
          { signal },
        ),
        cradleRequest<GetWorkspacesByWorkspaceIdFilesChildrenResponse>(
          connection!,
          `/workspaces/${encodeURIComponent(workspaceId)}/files/children`,
          { signal },
        ),
      ])
      const workspace = workspaces.find(candidate => candidate.id === workspaceId)
      if (!workspace) {
        throw new Error('Workspace not found')
      }
      return {
        workspace,
        sessions: sessions.items,
        works: works.items,
        files,
        workspaces: workspaces.filter(
          candidate =>
            candidate.availability === 'available' && candidate.locator.kind !== 'managed-worktree',
        ),
      }
    },
  })
  useSessionSummaryEvents(connection, isRouteActive, () => { void query.refetch() })

  const refresh = async () => {
    setIsRefreshing(true)
    try {
      await query.refetch()
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
        title="Could not open project"
        description={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <WorkspaceView
        {...query.data}
        isCreating={create.isPending}
        isRefreshing={isRefreshing}
        onCreate={input => create.mutate(input)}
        onOpenSession={sessionId => router.push(`/session/${sessionId}`)}
        onOpenWork={sessionId => router.push(`/session/${sessionId}`)}
        onOpenWorkInfo={workId => router.push(`/work/${workId}`)}
        onRefresh={() => void refresh()}
      />
    </>
  )
}
