import type { QueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { createGlobalSessionEventSource } from '~/features/chat/transport/chat-event-tail-transport'
import { getServerUrl } from '~/lib/electron'

import {
  applySessionTailEvent,
  recoverProjectionGap,
  refreshSessionLists,
  SESSION_LIST_REFRESH_INTERVAL_MS,
} from './api/session-projection'
import { GlobalSessionSyncEngine } from './global-session-sync-engine'

/**
 * Session event-tail adapter. Translates transport events into semantic facts
 * for the Session projection gateway — it owns no query keys itself — and
 * schedules the resettable fallback list poll that keeps lists warm while the
 * renderer is up.
 */
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
        void refreshSessionLists(queryClientRef.current).finally(() => {
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
          void applySessionTailEvent(queryClientRef.current, event)
          scheduleNextSessionListPoll()
        },
        onSnapshotRequired: (event) => {
          void recoverProjectionGap(queryClientRef.current, event?.sessionId ?? null)
            .catch((error) => {
              console.warn('[global-session-sync-engine] projection recovery failed', error)
            })
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
