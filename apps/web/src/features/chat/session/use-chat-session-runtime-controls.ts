import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import {
  getChatSessionsBySessionIdMessagesQueryKey,
  getSessionsByIdQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { isSessionsQueryKey } from '~/features/workspace/use-session'

import { runtimeUiSlotStatesQueryKey } from '../capabilities/chat-capabilities'
import { SNAPSHOT_SYNC_DEBOUNCE_MS } from './use-chat-session-types'

export interface ChatSessionRuntimeControls {
  queryClient: ReturnType<typeof useQueryClient>
  snapshotRowsQueryKey: ReturnType<typeof getChatSessionsBySessionIdMessagesQueryKey> | null
  sessionBindingQueryKey: ReturnType<typeof getSessionsByIdQueryKey> | null
  queueQueryKey: readonly ['chat', 'session-queue', string]
  scheduleSnapshotRefresh: (delay?: number) => void
  refreshRuntimeUiSlotStates: () => void
  refreshSessionLists: () => void
  refreshQueue: (delay?: number) => void
}

export function useChatSessionRuntimeControls(chatSessionId: string | null): ChatSessionRuntimeControls {
  const queryClient = useQueryClient()
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const snapshotRowsQueryKey = useMemo(
    () => chatSessionId
      ? getChatSessionsBySessionIdMessagesQueryKey({ path: { sessionId: chatSessionId } })
      : null,
    [chatSessionId],
  )
  const sessionBindingQueryKey = useMemo(
    () => chatSessionId
      ? getSessionsByIdQueryKey({ path: { id: chatSessionId } })
      : null,
    [chatSessionId],
  )

  const queueQueryKey = useMemo(
    () => ['chat', 'session-queue', chatSessionId ?? 'none'] as const,
    [chatSessionId],
  )

  const scheduleSnapshotRefresh = useCallback((delay = SNAPSHOT_SYNC_DEBOUNCE_MS) => {
    if (!snapshotRowsQueryKey && !sessionBindingQueryKey) {
      return
    }
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current)
    }
    snapshotTimerRef.current = setTimeout(() => {
      snapshotTimerRef.current = null
      if (snapshotRowsQueryKey) {
        void queryClient.invalidateQueries({ queryKey: snapshotRowsQueryKey })
      }
      if (sessionBindingQueryKey) {
        void queryClient.invalidateQueries({ queryKey: sessionBindingQueryKey })
      }
    }, delay)
  }, [queryClient, sessionBindingQueryKey, snapshotRowsQueryKey])

  const refreshSessionLists = useCallback(() => {
    void queryClient.invalidateQueries({ predicate: query => isSessionsQueryKey(query.queryKey) })
  }, [queryClient])

  const refreshRuntimeUiSlotStates = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(chatSessionId) })
  }, [chatSessionId, queryClient])

  const refreshQueue = useCallback((delay = 0) => {
    if (delay <= 0) {
      void queryClient.invalidateQueries({ queryKey: queueQueryKey })
      void queryClient.refetchQueries({ queryKey: queueQueryKey, type: 'active' })
      return
    }

    window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: queueQueryKey })
      void queryClient.refetchQueries({ queryKey: queueQueryKey, type: 'active' })
    }, delay)
  }, [queryClient, queueQueryKey])

  useEffect(() => {
    return () => {
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current)
        snapshotTimerRef.current = null
      }
    }
  }, [chatSessionId])

  return {
    queryClient,
    snapshotRowsQueryKey,
    sessionBindingQueryKey,
    queueQueryKey,
    scheduleSnapshotRefresh,
    refreshRuntimeUiSlotStates,
    refreshSessionLists,
    refreshQueue,
  }
}
