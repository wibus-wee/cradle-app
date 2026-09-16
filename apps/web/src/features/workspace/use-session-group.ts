import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteSessionGroupsByIdMutation,
  getSessionGroupsOptions,
  getSessionGroupsQueryKey,
  patchSessionGroupsByIdMutation,
  postSessionGroupsByIdMembersMutation,
  postSessionGroupsMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetSessionGroupsResponse } from '~/api-gen/types.gen'
import { refreshSessionLists } from '~/features/session/api/session-projection'
import { queryRefreshPolicy } from '~/lib/query-refresh-policy'

export type WorkspaceSessionGroup = GetSessionGroupsResponse[number]

export function sessionGroupsQueryKey(workspaceId?: string | null) {
  return getSessionGroupsQueryKey(
    workspaceId
      ? { query: { workspaceId } }
      : undefined,
  )
}

export function useSessionGroups(workspaceId: string | null | undefined) {
  return useQuery({
    ...getSessionGroupsOptions(
      workspaceId
        ? { query: { workspaceId } }
        : undefined,
    ),
    enabled: !!workspaceId,
    ...queryRefreshPolicy('interactive', { refetchInterval: false }),
  })
}

function invalidateSessionGroupQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | null | undefined,
) {
  void Promise.all([
    queryClient.invalidateQueries({ queryKey: sessionGroupsQueryKey(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: sessionGroupsQueryKey() }),
    refreshSessionLists(queryClient),
  ])
}

export function useCreateSessionGroup(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    ...postSessionGroupsMutation(),
    onSuccess: () => {
      invalidateSessionGroupQueries(queryClient, workspaceId)
    },
  })
}

export function useUpdateSessionGroup(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    ...patchSessionGroupsByIdMutation(),
    onSuccess: () => {
      invalidateSessionGroupQueries(queryClient, workspaceId)
    },
  })
}

export function useDeleteSessionGroup(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    ...deleteSessionGroupsByIdMutation(),
    onSuccess: () => {
      invalidateSessionGroupQueries(queryClient, workspaceId)
    },
  })
}

export function useAddSessionGroupMembers(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    ...postSessionGroupsByIdMembersMutation(),
    onSuccess: () => {
      invalidateSessionGroupQueries(queryClient, workspaceId)
    },
  })
}

export function useRemoveSessionGroupMember(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { groupId: string, sessionId: string }) => {
      const { deleteSessionGroupsByIdMembersBySessionId } = await import('~/api-gen/sdk.gen')
      await deleteSessionGroupsByIdMembersBySessionId({
        path: { id: input.groupId, sessionId: input.sessionId },
      })
    },
    onSuccess: () => {
      invalidateSessionGroupQueries(queryClient, workspaceId)
    },
  })
}
