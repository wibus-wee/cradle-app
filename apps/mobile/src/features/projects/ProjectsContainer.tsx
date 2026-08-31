import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'

import type { GetSessionsResponse, GetWorkspacesResponse } from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { useCreateWork } from '@/features/work/use-create-work'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'
import { useSessionSummaryEvents } from '@/lib/use-session-summary-events'

import { ProjectsView } from './ProjectsView'

export function ProjectsContainer() {
  const { connection } = useConnection()
  const create = useCreateWork()
  const isRouteActive = useRouteIsActive()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const query = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['projects', connection?.url],
    queryFn: async ({ signal }) => {
      const [workspaces, sessions] = await Promise.all([
        cradleRequest<GetWorkspacesResponse>(connection!, '/workspaces', { signal }),
        cradleRequest<GetSessionsResponse>(connection!, '/sessions/?archived=false&limit=200', { signal }),
      ])
      return workspaces
        .filter(workspace => workspace.locator.kind !== 'managed-worktree')
        .map(workspace => ({
          workspace,
          sessions: sessions.items.filter(session => session.workspaceId === workspace.id),
        }))
        .sort(
          (a, b) =>
            b.workspace.pinned - a.workspace.pinned || b.workspace.updatedAt - a.workspace.updatedAt,
        )
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

  if (!connection) {
    return null
  }
  if (query.isPending) {
    return <LoadingState />
  }
  if (query.error) {
    return <ErrorState title="Could not load projects" description={errorMessage(query.error)} />
  }
  return (
    <ProjectsView
      isCreating={create.isPending}
      isRefreshing={isRefreshing}
      onCreate={input => create.mutate(input)}
      onOpenUsage={() => router.push('/usage')}
      onOpenProject={workspaceId => router.push(`/workspace/${workspaceId}`)}
      onRefresh={() => void refresh()}
      projects={query.data}
    />
  )
}
