import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import {
  readPullRequestReviewDraft,
  writePullRequestReviewDraft,
} from './pull-request-review-draft'

const SAVE_DELAY_MS = 300

export function usePullRequestReviewDraft(
  connectionUrl: string | undefined,
  owner: string,
  repo: string,
  number: string,
) {
  const queryClient = useQueryClient()
  const latestDraftRef = useRef('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const query = useQuery({
    enabled: Boolean(connectionUrl),
    queryKey: ['pull-request-review-draft', connectionUrl, owner, repo, number],
    queryFn: () => readPullRequestReviewDraft(connectionUrl!, owner, repo, number),
    staleTime: Infinity,
  })

  useEffect(() => {
    if (query.data !== undefined) {
      latestDraftRef.current = query.data
    }
  }, [query.data])

  const scheduleSave = useCallback((body: string) => {
    latestDraftRef.current = body
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      if (connectionUrl) {
        queryClient.setQueryData(
          ['pull-request-review-draft', connectionUrl, owner, repo, number],
          body,
        )
        void writePullRequestReviewDraft(connectionUrl, owner, repo, number, body)
      }
    }, SAVE_DELAY_MS)
  }, [connectionUrl, number, owner, queryClient, repo])

  useEffect(() => () => {
    if (!saveTimerRef.current) {
      return
    }
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    if (connectionUrl) {
      queryClient.setQueryData(
        ['pull-request-review-draft', connectionUrl, owner, repo, number],
        latestDraftRef.current,
      )
      void writePullRequestReviewDraft(
        connectionUrl,
        owner,
        repo,
        number,
        latestDraftRef.current,
      )
    }
  }, [connectionUrl, number, owner, queryClient, repo])

  return {
    initialDraft: query.data ?? '',
    isPending: query.isPending && Boolean(connectionUrl),
    scheduleSave,
  }
}
