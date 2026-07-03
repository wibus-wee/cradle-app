import type { QueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import {
  getSessionsByIdQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import type { ChatGlobalSessionTailEvent, ChatSessionTailEventType } from '@cradle/chat-runtime-contracts'
import { runtimeSessionStatusQueryKey } from '~/features/chat/runtime/use-runtime-session-status'
import { createGlobalSessionEventSource } from '~/features/chat/transport/chat-event-tail-transport'
import { getServerUrl } from '~/lib/electron'

import { GlobalSessionSyncEngine } from './global-session-sync-engine'
import { isSessionsQueryKey } from './use-session'

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
  'QueueItemCancelled',
])

export function useGlobalSessionEventSync(queryClient: QueryClient): void {
  const queryClientRef = useRef(queryClient)

  useEffect(() => {
    queryClientRef.current = queryClient
  }, [queryClient])

  useEffect(() => {
    const engine = new GlobalSessionSyncEngine({
      serverBaseUrl: getServerUrl(),
      eventSourceFactory: createGlobalSessionEventSource,
      callbacks: {
        onSessionChanged: event => invalidateSessionProjection(queryClientRef.current, event),
        onSnapshotRequired: () => {
          void queryClientRef.current.invalidateQueries({
            predicate: query => isSessionsQueryKey(query.queryKey),
          })
        },
        onError: (error) => {
          console.warn('[global-session-sync-engine] event tail error', error)
        },
      },
    })
    engine.start()
    return () => {
      engine.stop()
    }
  }, [])
}

function invalidateSessionProjection(
  queryClient: QueryClient,
  event: ChatGlobalSessionTailEvent,
): void {
  void queryClient.invalidateQueries({
    queryKey: getSessionsByIdQueryKey({ path: { id: event.sessionId } }),
  })
  void queryClient.invalidateQueries({ predicate: query => isSessionsQueryKey(query.queryKey) })

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
