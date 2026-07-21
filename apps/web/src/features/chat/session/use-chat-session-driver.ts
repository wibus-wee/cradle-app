import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import { getServerUrl } from '~/lib/electron'
import { chatSelectors, useChatStore } from '~/store/chat'

import { chatMessageHistoryInfiniteOptions } from '../api/messages'
import type { RuntimeSessionRunStatus } from '../commands/runtime-session-status-command'
import { runtimeSessionStatusQueryKey } from '../commands/runtime-session-status-command'
import { useRuntimeSessionStatus } from '../runtime/use-runtime-session-status'
import { createChatSessionEventSource } from '../transport/chat-event-tail-transport'
import { openPassiveSessionStream } from './session-passive-stream'
import {
  deriveSessionPassiveStreamProjection,
  deriveSessionSnapshotProjection,
  deriveStableSessionSnapshotProjection,
} from './session-snapshot-projection'
import { SessionSyncEngine } from './session-sync-engine'
import { readStableMessageRows, writeStableMessageRows } from './stable-message-cache'
import { useChatSessionRuntimeControls } from './use-chat-session-runtime-controls'
import type { ChatSessionMessageRow } from './use-chat-session-types'
import {
  QUEUE_DRAIN_SYNC_DELAY_MS,
  readStableSnapshotRows,
  releaseSessionStreamingStateForTerminalRun,
} from './use-chat-session-types'

export function useChatSessionDriver(chatSessionId: string | null, active = true): void {
  const controls = useChatSessionRuntimeControls(chatSessionId)
  const {
    scheduleSnapshotRefresh,
    refreshQueue,
  } = controls
  const controlsRef = useRef(controls)
  controlsRef.current = controls
  const driverEnabled = active && !!chatSessionId
  const generatedSnapshotRowsOptions = useMemo(
    () => chatMessageHistoryInfiniteOptions(chatSessionId ?? ''),
    [chatSessionId],
  )
  const snapshotRowsQuery = useInfiniteQuery({
    ...generatedSnapshotRowsOptions,
    enabled: driverEnabled,
  })
  const runtimeStatusQuery = useRuntimeSessionStatus(driverEnabled ? chatSessionId : null, driverEnabled, {
    refetchInterval: false,
  })
  const snapshotRevision = snapshotRowsQuery.data?.pages[0]?.revision
  const snapshotNextCursor = snapshotRowsQuery.data?.pages.at(-1)?.nextCursor ?? null
  const snapshotRows = snapshotRowsQuery.data
    ? [...snapshotRowsQuery.data.pages]
        .reverse()
        .flatMap(page => page.rows) as ChatSessionMessageRow[]
    : undefined
  const runtimeStatus = runtimeStatusQuery.data
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reset freshness baseline when the session identity changes
  const mountedAtMs = useMemo(() => Date.now(), [chatSessionId])
  const snapshotDataUpdatedAtRef = useRef(snapshotRowsQuery.dataUpdatedAt)
  const authoritativeSnapshotObservedRef = useRef(false)
  const runtimeActiveRun = runtimeStatus?.activeRun ?? null
  const runtimeActiveRunMessageId = runtimeStatus?.activeRun?.messageId ?? null
  const runtimeStatusKnown = Boolean(runtimeStatus)
  const runtimeIdle = Boolean(
    runtimeStatus
    && runtimeStatus.status === 'idle'
    && !runtimeStatus.activeRun,
  )
  const syncEngineRef = useRef<SessionSyncEngine | null>(null)
  const pendingTerminalReleaseRef = useRef<{
    run: RuntimeSessionRunStatus
    requestedDataUpdatedAt: number
  } | null>(null)
  const pendingPassiveStreamLeaseReleaseRef = useRef<{
    messageId: string
    requestedDataUpdatedAt: number
  } | null>(null)
  const runtimeStatusFreshForSubscription = runtimeStatusQuery.isFetchedAfterMount
    && runtimeStatusQuery.dataUpdatedAt >= mountedAtMs

  useLayoutEffect(() => {
    snapshotDataUpdatedAtRef.current = snapshotRowsQuery.dataUpdatedAt
  }, [snapshotRowsQuery.dataUpdatedAt])

  useLayoutEffect(() => {
    authoritativeSnapshotObservedRef.current = false
  }, [chatSessionId])

  useLayoutEffect(() => {
    if (snapshotRows !== undefined) {
      authoritativeSnapshotObservedRef.current = true
    }
  }, [snapshotRows])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId || snapshotRevision === undefined) {
      return
    }

    const engine = new SessionSyncEngine({
      sessionId: chatSessionId,
      serverBaseUrl: getServerUrl(),
      afterVersion: snapshotRevision,
      eventSourceFactory: createChatSessionEventSource,
      passiveStreamFactory: request => openPassiveSessionStream({
        request,
        scheduleSnapshotRefresh: delay => controlsRef.current.scheduleSnapshotRefresh(delay),
        refreshQueue: delay => controlsRef.current.refreshQueue(delay),
        releaseStreamLeaseAfterSnapshot: (messageId) => {
          pendingPassiveStreamLeaseReleaseRef.current = {
            messageId,
            requestedDataUpdatedAt: snapshotDataUpdatedAtRef.current,
          }
          controlsRef.current.scheduleSnapshotRefresh(0)
        },
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
          controlsRef.current.scheduleSnapshotRefresh(0)
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
    snapshotRevision,
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
      if (cancelled || !cachedRows || authoritativeSnapshotObservedRef.current) {
        return
      }
      const stableRows = readStableSnapshotRows(cachedRows.rows)
      if (!stableRows) {
        return
      }

      const store = useChatStore.getState()
      if (
        authoritativeSnapshotObservedRef.current
        || (store.messagesMap.get(chatSessionId)?.length ?? 0) > 0
      ) {
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
      runtimeActiveRunMessageId: null,
    })
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
      existingMessages: store.messagesMap.get(chatSessionId) ?? [],
      runtimeStatusKnown,
      runtimeIdle,
      runtimeActiveRunMessageId,
    })
    if (!projection) {
      return
    }

    store.setMessages(chatSessionId, projection.messages)
    store.setSessionHydrated(chatSessionId, true)
    store.clearSessionErrors(chatSessionId)
    store.setPassiveRunState(chatSessionId, projection.passiveRunState)

    if (projection.failedMessage) {
      store.failGeneration(projection.failedMessage.messageId, projection.failedMessage.errorText)
    }
    if (projection.requestSnapshotRefresh) {
      scheduleSnapshotRefresh(0)
    }

    const pendingTerminalRelease = pendingTerminalReleaseRef.current
    if (
      pendingTerminalRelease
      && !snapshotRowsQuery.isFetching
      && snapshotRowsQuery.dataUpdatedAt > pendingTerminalRelease.requestedDataUpdatedAt
    ) {
      pendingTerminalReleaseRef.current = null
      const released = releaseSessionStreamingStateForTerminalRun(chatSessionId, pendingTerminalRelease.run)
      if (released) {
        refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
      }
    }

    const pendingPassiveStreamLeaseRelease = pendingPassiveStreamLeaseReleaseRef.current
    if (
      pendingPassiveStreamLeaseRelease
      && !snapshotRowsQuery.isFetching
      && snapshotRowsQuery.dataUpdatedAt > pendingPassiveStreamLeaseRelease.requestedDataUpdatedAt
    ) {
      pendingPassiveStreamLeaseReleaseRef.current = null
      const state = useChatStore.getState()
      if (state.streamLeaseMap.get(pendingPassiveStreamLeaseRelease.messageId)?.sessionId === chatSessionId) {
        state.releaseStreamLease(pendingPassiveStreamLeaseRelease.messageId)
        refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
      }
    }
  }, [chatSessionId, driverEnabled, refreshQueue, runtimeActiveRunMessageId, runtimeIdle, runtimeStatusKnown, scheduleSnapshotRefresh, snapshotRows, snapshotRowsQuery.dataUpdatedAt, snapshotRowsQuery.isFetching])

  useEffect(() => {
    if (
      !driverEnabled
      || !chatSessionId
      || snapshotRevision === undefined
      || !snapshotRows
      || runtimeActiveRunMessageId
    ) {
      return
    }
    const stableRows = readStableSnapshotRows(snapshotRows)
    if (!stableRows) {
      return
    }
    void writeStableMessageRows(
      chatSessionId,
      snapshotRevision,
      stableRows,
      snapshotNextCursor,
    ).catch((error: unknown) => {
      console.warn('[useChatSession] failed to write stable message cache', error)
    })
  }, [chatSessionId, driverEnabled, runtimeActiveRunMessageId, snapshotNextCursor, snapshotRevision, snapshotRows])

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

    if (action.terminalRunReleaseCandidate) {
      pendingTerminalReleaseRef.current = {
        run: action.terminalRunReleaseCandidate,
        requestedDataUpdatedAt: snapshotRowsQuery.dataUpdatedAt,
      }
      scheduleSnapshotRefresh(0)
      refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
    }

    if (action.requestQueueRefresh) {
      refreshQueue(0)
    }
  }, [chatSessionId, driverEnabled, refreshQueue, runtimeActiveRun, runtimeStatus, scheduleSnapshotRefresh, snapshotRows, snapshotRowsQuery.dataUpdatedAt])

  useEffect(() => {
    const runState = chatSessionId
      ? chatSelectors.sessionRunState(chatSessionId)(useChatStore.getState())
      : null
    const projection = deriveSessionPassiveStreamProjection({
      runState,
    })

    syncEngineRef.current?.updatePassiveStream({
      enabled: driverEnabled,
      sessionId: chatSessionId,
      locallyDriven: projection.locallyDriven,
      runtimeActiveRunMessageId: runtimeStatusFreshForSubscription ? runtimeActiveRunMessageId : null,
    })
  }, [chatSessionId, driverEnabled, runtimeActiveRunMessageId, runtimeStatus, runtimeStatusFreshForSubscription])
}
