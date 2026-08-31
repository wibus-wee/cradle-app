import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, Platform } from 'react-native'

import type {
  GetSessionsByIdResponse,
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

import { WorkspaceView } from './WorkspaceView'

export function WorkspaceContainer({ workspaceId }: { workspaceId: string }) {
  const { connection } = useConnection()
  const create = useCreateWork()
  const isRouteActive = useRouteIsActive()
  const queryClient = useQueryClient()
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
  const refresh = async () => {
    setIsRefreshing(true)
    try {
      await query.refetch()
    }
    finally {
      setIsRefreshing(false)
    }
  }
  const updateSessionPin = useMutation({
    mutationFn: ({ sessionId, pinned }: { sessionId: string, pinned: boolean }) =>
      cradleRequest<GetSessionsByIdResponse>(
        connection!,
        `/sessions/${encodeURIComponent(sessionId)}`,
        { body: { pinned }, method: 'PATCH' },
      ),
    onError: () => {
      Alert.alert('Could not update conversation', 'Your pin setting was not changed.')
    },
    onSuccess: async (session, { sessionId }) => {
      queryClient.setQueryData(['chat-session', connection?.url, sessionId], session)
      await query.refetch()
      void queryClient.invalidateQueries({ queryKey: ['mobile-tab-sessions', connection?.url] })
      void queryClient.invalidateQueries({ queryKey: ['projects', connection?.url] })
    },
  })

  if (query.isPending) {
    return <LoadingState />
  }
  if (query.error) {
    return (
      <ErrorState
        title="Could not open project"
        description={errorMessage(query.error)}
        isActionPending={query.isFetching}
        onAction={() => { void query.refetch() }}
      />
    )
  }
  return (
    <>
      <Stack.Screen options={{ title: Platform.OS === 'ios' ? query.data.workspace.name : '' }} />
      <WorkspaceView
        {...query.data}
        isCreating={create.isPending}
        isRefreshing={isRefreshing}
        onCreate={input => create.mutate(input)}
        onBrowseFiles={() => router.push(`/workspace/${workspaceId}/files`)}
        onOpenSession={sessionId => router.push(`/session/${sessionId}`)}
        onOpenFile={(entry) => {
          router.push({
            pathname: '/workspace/[workspaceId]/files',
            params: entry.type === 'directory'
              ? { workspaceId, path: entry.path }
              : { workspaceId, file: entry.path },
          })
        }}
        onOpenWork={sessionId => router.push(`/session/${sessionId}`)}
        onOpenWorkInfo={workId => router.push(`/work/${workId}`)}
        onRefresh={refresh}
        onSetSessionPinned={(sessionId, pinned) => updateSessionPin.mutate({ sessionId, pinned })}
        updatingSessionPinId={updateSessionPin.isPending ? updateSessionPin.variables?.sessionId : undefined}
      />
    </>
  )
}
