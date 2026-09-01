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

import { ProjectsView } from './ProjectsView'

interface ProjectsContainerProps {
  onSearchQueryChange: (query: string) => void
  searchQuery: string
  showsInlineSearch: boolean
}

export function ProjectsContainer({
  onSearchQueryChange,
  searchQuery,
  showsInlineSearch,
}: ProjectsContainerProps) {
  const { connection } = useConnection()
  const create = useCreateWork()
  const isRouteActive = useRouteIsActive()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const query = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['projects', connection?.resourceId],
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
    return (
      <ErrorState
        title="Could not load projects"
        description={errorMessage(query.error)}
        isActionPending={query.isFetching}
        onAction={() => { void query.refetch() }}
      />
    )
  }
  return (
    <ProjectsView
      isCreating={create.isPending}
      isRefreshing={isRefreshing}
      onCreate={input => create.mutate(input)}
      onOpenFiles={workspaceId => router.push(`/workspace/${workspaceId}/files`)}
      onOpenUsage={() => router.push('/usage')}
      onOpenProject={workspaceId => router.push(`/workspace/${workspaceId}`)}
      onRefresh={refresh}
      onSearchQueryChange={onSearchQueryChange}
      projects={query.data}
      searchQuery={searchQuery}
      showsInlineSearch={showsInlineSearch}
    />
  )
}
