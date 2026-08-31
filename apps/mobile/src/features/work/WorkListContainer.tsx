import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'

import type { GetWorkspacesResponse, GetWorksResponse } from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'
import { useSessionSummaryEvents } from '@/lib/use-session-summary-events'

import { useCreateWork } from './use-create-work'
import { WorkListView } from './WorkListView'

interface WorkListContainerProps {
  onSearchQueryChange: (query: string) => void
  searchQuery: string
  showsInlineSearch: boolean
}

export function WorkListContainer({
  onSearchQueryChange,
  searchQuery,
  showsInlineSearch,
}: WorkListContainerProps) {
  const { connection } = useConnection()
  const create = useCreateWork()
  const isRouteActive = useRouteIsActive()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const query = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['works', connection?.url],
    queryFn: async ({ signal }) => {
      const [works, archivedWorks, workspaces] = await Promise.all([
        cradleRequest<GetWorksResponse>(connection!, '/works?archived=false&limit=200', { signal }),
        cradleRequest<GetWorksResponse>(connection!, '/works?archived=true&limit=200', { signal }),
        cradleRequest<GetWorkspacesResponse>(connection!, '/workspaces', { signal }),
      ])
      return {
        works: works.items.sort((a, b) => b.updatedAt - a.updatedAt),
        archivedWorks: archivedWorks.items.sort((a, b) => b.updatedAt - a.updatedAt),
        workspaces: workspaces.filter(
          workspace =>
            workspace.availability === 'available' && workspace.locator.kind !== 'managed-worktree',
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
    return <ErrorState title="Could not load Work" description={errorMessage(query.error)} />
  }
  return (
    <WorkListView
      isCreating={create.isPending}
      isRefreshing={isRefreshing}
      onCreate={input => create.mutate(input)}
      onOpen={sessionId => router.push(`/session/${sessionId}`)}
      onOpenInfo={workId => router.push(`/work/${workId}`)}
      onOpenUsage={() => router.push('/usage')}
      onRefresh={refresh}
      onSearchQueryChange={onSearchQueryChange}
      searchQuery={searchQuery}
      showsInlineSearch={showsInlineSearch}
      {...query.data}
    />
  )
}
