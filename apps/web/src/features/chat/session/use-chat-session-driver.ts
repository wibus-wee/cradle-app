import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import {
  getChatSessionsBySessionIdMessagesOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { getServerUrl } from '~/lib/electron'
import { chatSelectors, useChatStore } from '~/store/chat'

import { runtimeSessionStatusQueryKey } from '../commands/runtime-session-status-command'
import { useRuntimeSessionStatus } from '../runtime/use-runtime-session-status'
import { createChatSessionEventSource } from '../transport/chat-event-tail-transport'
import { openPassiveSessionStream } from './session-passive-stream'
import { SessionSyncEngine } from './session-sync-engine'
import {
  deriveSessionPassiveStreamProjection,
  deriveSessionSnapshotProjection,
  deriveStableSessionSnapshotProjection,
} from './session-snapshot-projection'
import { readStableMessageRows, writeStableMessageRows } from './stable-message-cache'
import { useChatSessionRuntimeControls } from './use-chat-session-runtime-controls'
import type { ChatSessionMessageRow } from './use-chat-session-types'
import {
  detachPassiveSessionStreamingState,
  QUEUE_DRAIN_SYNC_DELAY_MS,
  readStableSnapshotRows,
  releaseSessionStreamingStateForTerminalRun,
} from './use-chat-session-types'

export function useChatSessionDriver(chatSessionId: string | null, active = true): void {
  const controls = useChatSessionRuntimeControls(chatSessionId)
  const {
    scheduleSnapshotRefresh,
    refreshQueue,
    refreshRuntimeUiSlotStates,
    refreshSessionLists,
  } = controls
  const controlsRef = useRef(controls)
  controlsRef.current = controls
  const driverEnabled = active && !!chatSessionId
  const generatedSnapshotRowsOptions = useMemo(
    () => getChatSessionsBySessionIdMessagesOptions({ path: { sessionId: chatSessionId ?? '' } }),
    [chatSessionId],
  )
  const snapshotRowsQuery = useQuery<
    unknown,
    Error,
    ChatSessionMessageRow[],
    ReturnType<typeof getChatSessionsBySessionIdMessagesOptions>['queryKey']
  >({
    queryKey: generatedSnapshotRowsOptions.queryKey,
    queryFn: generatedSnapshotRowsOptions.queryFn,
    enabled: driverEnabled,
    select: data => data as ChatSessionMessageRow[],
  })
  const runtimeStatusQuery = useRuntimeSessionStatus(driverEnabled ? chatSessionId : null, driverEnabled, {
    refetchInterval: false,
  })
  const snapshotRows = snapshotRowsQuery.data
  const runtimeStatus = runtimeStatusQuery.data
  const runtimeActiveRun = runtimeStatus?.activeRun ?? null
  const runtimeActiveRunMessageId = runtimeStatus?.activeRun?.messageId ?? null
  const runtimeStatusKnown = Boolean(runtimeStatus)
  const runtimeIdle = Boolean(
    runtimeStatus
    && runtimeStatus.status === 'idle'
    && !runtimeStatus.activeRun,
  )
  const syncEngineRef = useRef<SessionSyncEngine | null>(null)

  useEffect(() => {
    if (!driverEnabled || !chatSessionId) {
      return
    }

    const engine = new SessionSyncEngine({
      sessionId: chatSessionId,
      serverBaseUrl: getServerUrl(),
      eventSourceFactory: createChatSessionEventSource,
      passiveStreamFactory: request => openPassiveSessionStream({
        request,
        scheduleSnapshotRefresh: delay => controlsRef.current.scheduleSnapshotRefresh(delay),
        refreshQueue: delay => controlsRef.current.refreshQueue(delay),
      }),
      callbacks: {
        onMessagesChanged: () => {
          controlsRef.current.scheduleSnapshotRefresh(0)
        },
        onRuntimeStatusChanged: () => {
          void controlsRef.current.queryClient.invalidateQueries({
            queryKey: runtimeSessionStatusQueryKey(chatSessionId),
          })
        },
        onRuntimeUiSlotStatesChanged: () => {
          controlsRef.current.refreshRuntimeUiSlotStates()
        },
        onQueueChanged: () => {
          controlsRef.current.refreshQueue(0)
        },
        onSessionSummaryChanged: () => {
          controlsRef.current.refreshSessionLists()
          controlsRef.current.scheduleSnapshotRefresh(0)
        },
        onSnapshotRequired: () => {
          controlsRef.current.refreshSessionLists()
        },
        onError: (error) => {
          console.warn('[session-sync-engine] event tail error', error)
        },
      },
    })

    syncEngineRef.current = engine
    engine.start()

    return () => {
      if (syncEngineRef.current === engine) {
        syncEngineRef.current = null
      }
      engine.stop()
    }
  }, [
    chatSessionId,
    driverEnabled,
  ])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId) {
      return
    }

    let cancelled = false
    void (async () => {
      const cachedRows = await readStableMessageRows(chatSessionId).catch((error: unknown) => {
        console.warn('[useChatSession] failed to read stable message cache', error)
        return null
      })
      if (cancelled || !cachedRows) {
        return
      }
      const stableRows = readStableSnapshotRows(cachedRows)
      if (!stableRows) {
        return
      }

      const store = useChatStore.getState()
      if ((store.messagesMap.get(chatSessionId)?.length ?? 0) > 0) {
        return
      }

      const projection = deriveStableSessionSnapshotProjection(stableRows)
      store.setMessages(chatSessionId, projection.messages)
      store.setSessionHydrated(chatSessionId, true)
      store.clearSessionErrors(chatSessionId)
      store.setPassiveRunState(chatSessionId, projection.passiveRunState)

      if (projection.failedMessage) {
        store.failGeneration(projection.failedMessage.messageId, projection.failedMessage.errorText)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [chatSessionId, driverEnabled])

  useEffect(() => {
    if (driverEnabled) {
      return
    }
    syncEngineRef.current?.updatePassiveStream({
      enabled: false,
      sessionId: chatSessionId,
      locallyDriven: false,
      holdEmptyStreamingSnapshot: false,
      runtimeActiveRunMessageId: null,
      snapshotStreamingMessageIds: [],
    })
    if (chatSessionId) {
      detachPassiveSessionStreamingState(chatSessionId)
    }
  }, [chatSessionId, driverEnabled])

  useLayoutEffect(() => {
    if (!driverEnabled || !chatSessionId || !snapshotRows) {
      return
    }
    const runState = chatSelectors.sessionRunState(chatSessionId)(useChatStore.getState())
    const store = useChatStore.getState()
    const projection = deriveSessionSnapshotProjection({
      rows: snapshotRows,
      runState,
      existingMessageCount: store.messagesMap.get(chatSessionId)?.length ?? 0,
      runtimeStatusKnown,
      runtimeIdle,
      runtimeActiveRunMessageId,
      snapshotFetching: snapshotRowsQuery.isFetching,
    })
    if (!projection) {
      return
    }

    if (projection.messages) {
      store.setMessages(chatSessionId, projection.messages)
    }
    store.setSessionHydrated(chatSessionId, true)
    store.clearSessionErrors(chatSessionId)
    store.setPassiveRunState(chatSessionId, projection.passiveRunState)

    if (projection.failedMessage) {
      store.failGeneration(projection.failedMessage.messageId, projection.failedMessage.errorText)
    }
    if (projection.requestSnapshotRefresh) {
      scheduleSnapshotRefresh(0)
    }
  }, [chatSessionId, driverEnabled, runtimeActiveRunMessageId, runtimeIdle, runtimeStatusKnown, scheduleSnapshotRefresh, snapshotRows, snapshotRowsQuery.isFetching])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId || !snapshotRows || runtimeActiveRunMessageId) {
      return
    }
    const stableRows = readStableSnapshotRows(snapshotRows)
    if (!stableRows) {
      return
    }
    void writeStableMessageRows(chatSessionId, stableRows).catch((error: unknown) => {
      console.warn('[useChatSession] failed to write stable message cache', error)
    })
  }, [chatSessionId, driverEnabled, runtimeActiveRunMessageId, snapshotRows])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId || !snapshotRowsQuery.isError) {
      return
    }
    useChatStore.getState().setSessionHydrated(chatSessionId, true)
    useChatStore.getState().setPassiveRunState(chatSessionId, { messageIds: [], status: 'error' })
  }, [chatSessionId, driverEnabled, snapshotRowsQuery.isError])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId) {
      return
    }

    const store = useChatStore.getState()
    const storeMessageIds = new Set((store.messagesMap.get(chatSessionId) ?? []).map(message => message.id))
    const snapshotMessageIds = new Set((snapshotRows ?? []).map(row => row.messageId))
    const action = syncEngineRef.current?.reconcileRuntimeState({
      runtimeStatus,
      activeRun: runtimeActiveRun,
      snapshotMessageIds,
      storeMessageIds,
    })
    if (!action) {
      return
    }

    if (action.runDisplay) {
      store.setRunDisplayId(action.runDisplay.messageId, action.runDisplay.runId)
    }
    if (action.requestSnapshotRefresh) {
      scheduleSnapshotRefresh(0)
    }

    const released = releaseSessionStreamingStateForTerminalRun(chatSessionId, action.terminalRunReleaseCandidate)
    if (released) {
      scheduleSnapshotRefresh(0)
      refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
    }

    if (action.requestQueueRefresh) {
      refreshQueue(0)
    }
  }, [chatSessionId, driverEnabled, refreshQueue, runtimeActiveRun, runtimeStatus, scheduleSnapshotRefresh, snapshotRows])

  useEffect(() => {
    const runState = chatSessionId
      ? chatSelectors.sessionRunState(chatSessionId)(useChatStore.getState())
      : null
    const projection = deriveSessionPassiveStreamProjection({
      rows: snapshotRows,
      runState,
      runtimeStatusKnown,
      runtimeIdle,
      snapshotFetching: snapshotRowsQuery.isFetching,
    })

    syncEngineRef.current?.updatePassiveStream({
      enabled: driverEnabled,
      sessionId: chatSessionId,
      locallyDriven: projection.locallyDriven,
      holdEmptyStreamingSnapshot: projection.holdEmptyStreamingSnapshot,
      runtimeActiveRunMessageId,
      snapshotStreamingMessageIds: projection.snapshotStreamingMessageIds,
    })
  }, [chatSessionId, driverEnabled, runtimeActiveRunMessageId, runtimeIdle, runtimeStatusKnown, snapshotRows, snapshotRowsQuery.isFetching])
}
