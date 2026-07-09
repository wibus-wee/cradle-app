import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { client } from '~/api-gen/client.gen'

export interface SessionPullRequest {
  owner: string
  repo: string
  number: number
  url: string
  title: string
  isDraft: boolean
  state: 'open' | 'closed'
  merged: boolean
  headRef: string
  baseRef: string
  headSha: string | null
  createdAt: number
  updatedAt: number
}

type PullRequestEnvelope = {
  pullRequest: SessionPullRequest | null
}

export function sessionPullRequestQueryKey(sessionId: string) {
  return ['sessions', sessionId, 'pull-request'] as const
}

export function useSessionPullRequest(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: sessionPullRequestQueryKey(sessionId ?? ''),
    enabled: !!sessionId,
    queryFn: async (): Promise<SessionPullRequest | null> => {
      // hey-api client unwraps single-key response objects to the value type.
      const { data } = await client.get<PullRequestEnvelope>({
        url: `/sessions/${sessionId}/pull-request`,
      })
      return data ?? null
    },
    staleTime: 15_000,
    refetchInterval: (query) => {
      const pr = query.state.data
      return pr && pr.state === 'open' ? 30_000 : false
    },
  })
}

export function useMarkSessionPullRequestReady() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: string): Promise<SessionPullRequest> => {
      const { data } = await client.post<{ pullRequest: SessionPullRequest }>({
        url: `/sessions/${sessionId}/pull-request/ready`,
      })
      if (!data) {
        throw new Error('Failed to mark pull request ready')
      }
      return data
    },
    onSuccess: (data, sessionId) => {
      queryClient.setQueryData(sessionPullRequestQueryKey(sessionId), data)
      void queryClient.invalidateQueries({ queryKey: getSessionsByIdQueryKey({ path: { id: sessionId } }) })
    },
  })
}
