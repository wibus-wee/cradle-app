import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'

import type {
  GetWorkspacesByWorkspaceIdFilesContentResponse,
  GetWorkspacesByWorkspaceIdFilesInfoResponse,
} from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'

import { FilePreviewView } from './FilePreviewView'

interface FilePreviewContainerProps {
  workspaceId: string
  path: string
}

export function FilePreviewContainer({ workspaceId, path }: FilePreviewContainerProps) {
  const { connection } = useConnection()
  const isRouteActive = useRouteIsActive()
  const query = useQuery({
    enabled: Boolean(connection && path) && isRouteActive,
    queryKey: ['workspace-file-preview', connection?.url, workspaceId, path],
    queryFn: async ({ signal }) => {
      const queryPath = `path=${encodeURIComponent(path)}`
      const file = await cradleRequest<GetWorkspacesByWorkspaceIdFilesInfoResponse>(
        connection!,
        `/workspaces/${encodeURIComponent(workspaceId)}/files/info?${queryPath}`,
        { signal },
      )
      if (file.previewKind !== 'text' && file.previewKind !== 'markdown') {
        return { file, content: null }
      }
      const result = await cradleRequest<GetWorkspacesByWorkspaceIdFilesContentResponse>(
        connection!,
        `/workspaces/${encodeURIComponent(workspaceId)}/files/content?${queryPath}`,
        { signal },
      )
      if (result.content === null) {
        throw new Error('Workspace file was not found.')
      }
      return { file, content: result.content }
    },
  })

  if (query.isPending) {
    return <LoadingState />
  }
  if (query.error) {
    return (
      <ErrorState
        title="Could not open file"
        description={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }
  return (
    <>
      <Stack.Screen options={{ title: query.data.file.name }} />
      <FilePreviewView
        {...query.data}
        isRefreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
      />
    </>
  )
}
