import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getSessionsByIdIsolationOptions,
  getWorkspacesByWorkspaceIdGitRepositoriesQueryKey,
  getWorkspacesByWorkspaceIdGitStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { client } from '~/api-gen/client.gen'
import {
  postSessionsByIdIsolationActivate,
  postSessionsByIdIsolationAttach,
  postSessionsByIdIsolationCancel,
  postSessionsByIdIsolationLeave,
  postSessionsByIdIsolationStart,
} from '~/api-gen/sdk.gen'

import { refreshSessionLists, refreshSessionProjections } from './api/session-projection'

export interface IssueIsolationContextGroup {
  worktreeId: string
  name: string
  branch: string
  sessionIds: string[]
  sessionTitles: string[]
}

export interface IssueIsolationContext {
  groups: IssueIsolationContextGroup[]
}

export function issueIsolationContextQueryKey(issueId: string) {
  return ['issues', issueId, 'isolation-context'] as const
}

export function useIssueIsolationContext(issueId: string | null | undefined) {
  return useQuery({
    queryKey: issueIsolationContextQueryKey(issueId ?? ''),
    enabled: !!issueId,
    queryFn: async (): Promise<IssueIsolationContext> => {
      const { data } = await client.get<IssueIsolationContext>({
        url: `/issues/${issueId}/isolation-context`,
      })
      return data ?? { groups: [] }
    },
    staleTime: 30_000,
  })
}

export function useSessionIsolationState(sessionId: string | null | undefined) {
  return useQuery({
    ...getSessionsByIdIsolationOptions({ path: { id: sessionId ?? '' } }),
    enabled: !!sessionId,
    staleTime: 5_000,
  })
}

function invalidateSessionIsolationQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  workspaceId?: string | null,
) {
  void refreshSessionProjections(queryClient, sessionId)
  void queryClient.invalidateQueries({ queryKey: getSessionsByIdIsolationOptions({ path: { id: sessionId } }).queryKey })
  if (workspaceId) {
    void queryClient.invalidateQueries({
      queryKey: getWorkspacesByWorkspaceIdGitStatusQueryKey({ path: { workspaceId } }),
    })
    void queryClient.invalidateQueries({
      queryKey: getWorkspacesByWorkspaceIdGitRepositoriesQueryKey({ path: { workspaceId } }),
    })
  }
}

export function useStartSessionIsolation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { sessionId: string, slug?: string, workspaceId?: string | null }) => {
      const { data } = await postSessionsByIdIsolationStart({
        path: { id: input.sessionId },
        body: { slug: input.slug },
      })
      return data
    },
    onSuccess: (_data, vars) => {
      invalidateSessionIsolationQueries(queryClient, vars.sessionId, vars.workspaceId)
    },
  })
}

export function useActivateSessionIsolation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      sessionId: string
      mode: 'migrate' | 'leave-main' | 'cancel'
      workspaceId?: string | null
    }) => {
      await postSessionsByIdIsolationActivate({
        path: { id: input.sessionId },
        body: { mode: input.mode },
      })
    },
    onSuccess: (_data, vars) => {
      invalidateSessionIsolationQueries(queryClient, vars.sessionId, vars.workspaceId)
    },
  })
}

export function useCancelSessionIsolation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { sessionId: string, workspaceId?: string | null }) => {
      await postSessionsByIdIsolationCancel({ path: { id: input.sessionId } })
    },
    onSuccess: (_data, vars) => {
      invalidateSessionIsolationQueries(queryClient, vars.sessionId, vars.workspaceId)
    },
  })
}

export function useLeaveSessionIsolation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { sessionId: string, workspaceId?: string | null }) => {
      await postSessionsByIdIsolationLeave({ path: { id: input.sessionId } })
    },
    onSuccess: (_data, vars) => {
      invalidateSessionIsolationQueries(queryClient, vars.sessionId, vars.workspaceId)
    },
  })
}

export function useAttachSessionToWorktree() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { sessionId: string, worktreeId: string, workspaceId?: string | null }) => {
      await postSessionsByIdIsolationAttach({
        path: { id: input.sessionId },
        body: { worktreeId: input.worktreeId },
      })
    },
    onSuccess: (_data, vars) => {
      invalidateSessionIsolationQueries(queryClient, vars.sessionId, vars.workspaceId)
    },
  })
}

export function useRepairSessionIsolation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { sessionId: string, workspaceId?: string | null }) => {
      const { data } = await client.post<{ worktree: { id: string } }>({
        url: `/sessions/${input.sessionId}/isolation/repair`,
      })
      return data
    },
    onSuccess: (_data, vars) => {
      invalidateSessionIsolationQueries(queryClient, vars.sessionId, vars.workspaceId)
    },
  })
}

export function useCleanupWorktree() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      workspaceId: string
      worktreeId: string
      mode: 'merge-and-close' | 'abandon'
      targetBranch?: string
    }) => {
      await client.post({
        url: `/workspaces/${input.workspaceId}/worktrees/${input.worktreeId}/cleanup`,
        body: {
          mode: input.mode,
          targetBranch: input.targetBranch,
        },
      })
    },
    onSuccess: (_data, vars) => {
      void refreshSessionLists(queryClient)
      void queryClient.invalidateQueries({
        queryKey: getWorkspacesByWorkspaceIdGitStatusQueryKey({ path: { workspaceId: vars.workspaceId } }),
      })
      void queryClient.invalidateQueries({
        queryKey: getWorkspacesByWorkspaceIdGitRepositoriesQueryKey({ path: { workspaceId: vars.workspaceId } }),
      })
    },
  })
}
