import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getSessionsByIdQueryKey,
  getSessionsByIdWorkOptions,
  getSessionsByIdWorkQueryKey,
  getWorksAttentionOptions,
  getWorksAttentionQueryKey,
  getWorksByIdOptions,
  getWorksByIdQueryKey,
  getWorksOptions,
  getWorksQueryKey,
  postWorksByIdArchiveMutation,
  postWorksByIdRedetectMutation,
  postWorksByIdSubmitMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetSessionsByIdWorkResponse,
  GetWorksAttentionResponse,
  GetWorksByIdResponse,
  GetWorksResponse,
} from '~/api-gen/types.gen'

export type WorkDetail = GetWorksByIdResponse
export type WorkSummary = GetWorksResponse[number]
export type WorkAttentionItem = GetWorksAttentionResponse[number]
export type SessionWorkResolution = GetSessionsByIdWorkResponse

export const WORK_PULL_REQUEST_REFRESH_INTERVAL_MS = 30_000

export function hasOpenWorkPullRequest(works: readonly WorkSummary[] | undefined): boolean {
  return works?.some(work => work.pullRequest?.state === 'open' && !work.pullRequest.merged) ?? false
}

export function useWorkDetail(workId: string | null | undefined) {
  return useQuery({
    ...getWorksByIdOptions({ path: { id: workId ?? '' } }),
    enabled: !!workId,
    refetchInterval: 10_000,
  })
}

export function useWorks(options?: {
  workspaceId?: string | null
  archived?: boolean
  enabled?: boolean
}) {
  const workspaceId = options?.workspaceId
  const archived = options?.archived
  return useQuery({
    ...getWorksOptions({
      query: {
        ...(workspaceId ? { workspaceId } : {}),
        ...(archived === undefined ? {} : { archived }),
      },
    }),
    enabled: options?.enabled ?? true,
    staleTime: 5_000,
    refetchInterval: query => hasOpenWorkPullRequest(query.state.data)
      ? WORK_PULL_REQUEST_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: true,
  })
}

export function useWorkspaceWorks(workspaceId: string | null | undefined) {
  return useWorks({
    workspaceId,
    enabled: !!workspaceId,
  })
}

export function useSessionWork(sessionId: string | null | undefined) {
  return useQuery({
    ...getSessionsByIdWorkOptions({ path: { id: sessionId ?? '' } }),
    enabled: !!sessionId,
    staleTime: 30_000,
  })
}

export function useWorkAttention() {
  return useQuery({
    ...getWorksAttentionOptions(),
    staleTime: 3_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  })
}

function invalidateWorkQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  detail: WorkDetail,
) {
  queryClient.setQueryData(
    getWorksByIdQueryKey({ path: { id: detail.work.id } }),
    detail,
  )
  void queryClient.invalidateQueries({ queryKey: getWorksQueryKey() })
  void queryClient.invalidateQueries({
    queryKey: getSessionsByIdWorkQueryKey({ path: { id: detail.primaryThread.id } }),
  })
  void queryClient.invalidateQueries({
    queryKey: getSessionsByIdQueryKey({ path: { id: detail.primaryThread.id } }),
  })
}

export function useSubmitWork() {
  const queryClient = useQueryClient()
  return useMutation({
    ...postWorksByIdSubmitMutation(),
    onSuccess: detail => invalidateWorkQueries(queryClient, detail),
  })
}

export function useArchiveWork() {
  const queryClient = useQueryClient()
  return useMutation({
    ...postWorksByIdArchiveMutation(),
    onSuccess: detail => invalidateWorkQueries(queryClient, detail),
  })
}

export function useRedetectWork() {
  const queryClient = useQueryClient()
  return useMutation({
    ...postWorksByIdRedetectMutation(),
    onSuccess: (detail) => {
      invalidateWorkQueries(queryClient, detail)
      void queryClient.invalidateQueries({ queryKey: getWorksAttentionQueryKey() })
    },
  })
}
