import type { ChatGlobalSessionTailEvent, ChatSessionTailEventType } from '@cradle/chat-runtime-contracts'
import type { QueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import {
  getSessionsByIdQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { runtimeSessionStatusQueryKey } from '~/features/chat/runtime/use-runtime-session-status'
import { createGlobalSessionEventSource } from '~/features/chat/transport/chat-event-tail-transport'
import { getServerUrl } from '~/lib/electron'

import { GlobalSessionSyncEngine } from './global-session-sync-engine'
import {
  isSessionsQueryKey,
  SESSION_LIST_REFRESH_INTERVAL_MS,
} from './use-session'

const RUNTIME_EVENT_TYPES = new Set<ChatSessionTailEventType>([
  'RunStarted',
  'InteractionRequested',
  'InteractionResolved',
  'RunCompleted',
  'RunFailed',
  'RunAborted',
])

const QUEUE_EVENT_TYPES = new Set<ChatSessionTailEventType>([
  'QueueItemEnqueued',
  'QueueItemClaimed',
  'QueueItemReleased',
  'QueueItemFailed',
  'QueueItemReordered',
  'QueueItemUpdated',
  'QueueItemProviderTargetCleared',
  'QueueItemCancelled',
])

export function useGlobalSessionEventSync(queryClient: QueryClient): void {
  const queryClientRef = useRef(queryClient)

  useEffect(() => {
    queryClientRef.current = queryClient
  }, [queryClient])

  useEffect(() => {
    let pollTimeout: ReturnType<typeof setTimeout> | null = null
    let pollGeneration = 0

    const scheduleNextSessionListPoll = () => {
      pollGeneration += 1
      const scheduledGeneration = pollGeneration
      if (pollTimeout !== null) {
        clearTimeout(pollTimeout)
      }
      pollTimeout = setTimeout(() => {
        pollTimeout = null
        void invalidateSessionLists(queryClientRef.current).finally(() => {
          if (pollGeneration === scheduledGeneration) {
            scheduleNextSessionListPoll()
          }
        })
      }, SESSION_LIST_REFRESH_INTERVAL_MS)
    }

    const engine = new GlobalSessionSyncEngine({
      serverBaseUrl: getServerUrl(),
      eventSourceFactory: createGlobalSessionEventSource,
      callbacks: {
        onSessionChanged: (event) => {
          invalidateSessionProjection(queryClientRef.current, event)
          scheduleNextSessionListPoll()
        },
        onSnapshotRequired: () => {
          void invalidateSessionLists(queryClientRef.current)
          scheduleNextSessionListPoll()
        },
        onError: (error) => {
          console.warn('[global-session-sync-engine] event tail error', error)
        },
      },
    })
    engine.start()
    scheduleNextSessionListPoll()
    return () => {
      engine.stop()
      pollGeneration += 1
      if (pollTimeout !== null) {
        clearTimeout(pollTimeout)
      }
    }
  }, [])
}

function invalidateSessionLists(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: query => isSessionsQueryKey(query.queryKey),
  })
}

function invalidateSessionProjection(
  queryClient: QueryClient,
  event: ChatGlobalSessionTailEvent,
): void {
  void queryClient.invalidateQueries({
    queryKey: getSessionsByIdQueryKey({ path: { id: event.sessionId } }),
  })
  void invalidateSessionLists(queryClient)

  if (RUNTIME_EVENT_TYPES.has(event.type)) {
    void queryClient.invalidateQueries({ queryKey: runtimeSessionStatusQueryKey(event.sessionId) })
  }
  if (QUEUE_EVENT_TYPES.has(event.type)) {
    void queryClient.invalidateQueries({ queryKey: ['chat', 'session-queue', event.sessionId] })
    void queryClient.refetchQueries({
      queryKey: ['chat', 'session-queue', event.sessionId],
      type: 'active',
    })
  }
}
