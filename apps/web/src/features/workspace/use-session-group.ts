import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteSessionGroupsByIdMutation,
  getSessionGroupsOptions,
  patchSessionGroupsByIdMutation,
  postSessionGroupsByIdMembersMutation,
  postSessionGroupsMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetSessionGroupsResponse } from '~/api-gen/types.gen'
import { reconcileIssueExecutionAssociation } from '~/features/kanban/use-issue-execution-association'
import { refreshSessionLists } from '~/features/session/api/session-projection'
import { queryRefreshPolicy } from '~/lib/query-refresh-policy'

import { refreshSessionGroupProjections, sessionGroupsQueryKey } from './session-group-projection'

export { sessionGroupsQueryKey } from './session-group-projection'

export type WorkspaceSessionGroup = GetSessionGroupsResponse[number]

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
  groupId?: string,
) {
  void Promise.all([
    // The caller's workspace-scoped list plus every other cached variant
    // (unscoped, linkedIssueId-filtered) reconciled through the owner API.
    queryClient.invalidateQueries({ queryKey: sessionGroupsQueryKey(workspaceId) }),
    refreshSessionGroupProjections(queryClient, { groupId }),
    refreshSessionLists(queryClient),
  ])
}

export function useCreateSessionGroup(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    ...postSessionGroupsMutation(),
    onSuccess: (data) => {
      invalidateSessionGroupQueries(queryClient, workspaceId, data?.id)
      // Create-with-link attaches the Issue association atomically on the
      // server; reconcile the Issue's linked-group projection through the
      // shared transition path.
      if (data?.linkedIssueId) {
        void reconcileIssueExecutionAssociation(queryClient, {
          participantKind: 'session-group',
          participantId: data.id,
          previousIssueId: null,
          nextIssueId: data.linkedIssueId,
        })
      }
    },
  })
}

export function useUpdateSessionGroup(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    ...patchSessionGroupsByIdMutation(),
    onSuccess: (data) => {
      invalidateSessionGroupQueries(queryClient, workspaceId, data?.group.id)
      // Link/unlink/relink writes carry the typed association transition so
      // participant and old/new Issue projections reconcile together.
      if (data?.association) {
        void reconcileIssueExecutionAssociation(queryClient, data.association)
      }
    },
  })
}

export function useDeleteSessionGroup(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    ...deleteSessionGroupsByIdMutation(),
    onSuccess: (_data, vars) => {
      invalidateSessionGroupQueries(queryClient, workspaceId, vars?.path?.id)
    },
  })
}

export function useAddSessionGroupMembers(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    ...postSessionGroupsByIdMembersMutation(),
    onSuccess: (_data, vars) => {
      invalidateSessionGroupQueries(queryClient, workspaceId, vars?.path?.id)
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
    onSuccess: (_data, vars) => {
      invalidateSessionGroupQueries(queryClient, workspaceId, vars.groupId)
    },
  })
}
