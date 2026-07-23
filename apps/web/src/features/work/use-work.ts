import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getSessionsByIdQueryKey,
  getSessionsByIdWorkOptions,
  getSessionsByIdWorkQueryKey,
  getWorksByIdOptions,
  getWorksByIdQueryKey,
  getWorksOptions,
  getWorksQueryKey,
  postWorksByIdArchiveMutation,
  postWorksByIdSubmitMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetSessionsByIdWorkResponse,
  GetWorksByIdResponse,
  GetWorksResponse,
} from '~/api-gen/types.gen'

export type WorkDetail = GetWorksByIdResponse
export type WorkSummary = GetWorksResponse[number]
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

export function useWorkspaceWorks(workspaceId: string | null | undefined) {
  return useQuery({
    ...getWorksOptions({ query: workspaceId ? { workspaceId } : undefined }),
    enabled: !!workspaceId,
    staleTime: 5_000,
    refetchInterval: query => hasOpenWorkPullRequest(query.state.data)
      ? WORK_PULL_REQUEST_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: true,
  })
}

export function useSessionWork(sessionId: string | null | undefined) {
  return useQuery({
    ...getSessionsByIdWorkOptions({ path: { id: sessionId ?? '' } }),
    enabled: !!sessionId,
    staleTime: 30_000,
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
