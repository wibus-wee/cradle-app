import { useQuery } from '@tanstack/react-query'
import { router, Stack } from 'expo-router'

import type { GetWorkspacesByWorkspaceIdFilesChildrenResponse } from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'

import { WorkspaceDirectoryView } from './WorkspaceDirectoryView'

interface WorkspaceDirectoryContainerProps {
  workspaceId: string
  path: string
}

export function WorkspaceDirectoryContainer({ workspaceId, path }: WorkspaceDirectoryContainerProps) {
  const { connection } = useConnection()
  const isRouteActive = useRouteIsActive()
  const query = useQuery({
    enabled: Boolean(connection && path) && isRouteActive,
    queryKey: ['workspace-directory', connection?.url, workspaceId, path],
    queryFn: ({ signal }) =>
      cradleRequest<GetWorkspacesByWorkspaceIdFilesChildrenResponse>(
        connection!,
        `/workspaces/${encodeURIComponent(workspaceId)}/files/children?path=${encodeURIComponent(path)}`,
        { signal },
      ),
  })

  if (query.isPending) {
    return <LoadingState />
  }
  if (query.error) {
    return (
      <ErrorState
        title="Could not open directory"
        description={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: path.split('/').at(-1) || 'Directory' }} />
      <WorkspaceDirectoryView
        entries={query.data}
        isRefreshing={query.isRefetching}
        onOpenDirectory={directoryPath => router.push({
          pathname: '/workspace-directory',
          params: { workspaceId, path: directoryPath },
        })}
        onOpenFile={filePath => router.push({
          pathname: '/workspace-file',
          params: { workspaceId, path: filePath },
        })}
        onRefresh={() => void query.refetch()}
      />
    </>
  )
}
