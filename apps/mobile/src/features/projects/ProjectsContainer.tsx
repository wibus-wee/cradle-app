import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'

import type { GetSessionsResponse, GetWorkspacesResponse } from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

import { ProjectsView } from './ProjectsView'

export function ProjectsContainer() {
  const { connection } = useConnection()
  const query = useQuery({
    enabled: Boolean(connection),
    queryKey: ['projects', connection?.url],
    queryFn: async () => {
      const [workspaces, sessions] = await Promise.all([
        cradleRequest<GetWorkspacesResponse>(connection!, '/workspaces'),
        cradleRequest<GetSessionsResponse>(connection!, '/sessions/?archived=false'),
      ])
      return workspaces
        .filter(workspace => workspace.locator.kind !== 'managed-worktree')
        .map(workspace => ({
          workspace,
          sessions: sessions.filter(session => session.workspaceId === workspace.id),
        }))
        .sort((a, b) => b.workspace.pinned - a.workspace.pinned || b.workspace.updatedAt - a.workspace.updatedAt)
    },
    refetchInterval: data => data.state.data?.some(project =>
      project.sessions.some(session => session.status === 'streaming'))
? 2_000
: 15_000,
  })

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
      isRefreshing={query.isRefetching}
      onOpenProject={workspaceId => router.push(`/workspace/${workspaceId}`)}
      onRefresh={() => void query.refetch()}
      projects={query.data}
    />
  )
}
