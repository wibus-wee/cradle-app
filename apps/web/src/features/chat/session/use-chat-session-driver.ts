import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import {
  getChatSessionsBySessionIdMessagesOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { useChatStore } from '~/store/chat'

import { useRuntimeSessionStatus } from '../runtime/use-runtime-session-status'
import { subscribeChatSessionStreamForSession } from '../transport/chat-stream-transport'
import { ChatStreamingHandler } from '../transport/chat-streaming-handler'
import { readStableMessageRows, writeStableMessageRows } from './stable-message-cache'
import { useChatSessionRuntimeControls } from './use-chat-session-runtime-controls'
import type { ChatSessionMessageRow } from './use-chat-session-types'
import {
  derivePassiveStatus,
  projectMainMessagesFromSnapshotRows,
  projectRowsWithoutEmptyStreamingAssistant,
  projectStreamingMainAssistantMessageIds,
  QUEUE_DRAIN_SYNC_DELAY_MS,
  readLatestFailedMainAssistantRow,
  readStableSnapshotRows,
  detachPassiveSessionStreamingState,
  isTerminalChatRunStatus,
  releaseSessionStreamingStateForTerminalRun,
  shouldHoldEmptyStreamingSnapshot,
} from './use-chat-session-types'

export function useChatSessionDriver(chatSessionId: string | null, active = true): void {
  const {
    scheduleSnapshotRefresh,
    refreshQueue,
  } = useChatSessionRuntimeControls(chatSessionId)
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
  const runtimeStatusQuery = useRuntimeSessionStatus(driverEnabled ? chatSessionId : null)
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
  const passiveStreamRef = useRef<{
    sessionId: string
    messageId: string
    controller: AbortController
    handler: ChatStreamingHandler
  } | null>(null)
  const requestedRuntimeActiveRunMessageRef = useRef<string | null>(null)
  const runtimeQueueSignatureRef = useRef<string | null>(null)
  const latestTerminalRunRefreshRef = useRef<string | null>(null)

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

      store.setMessages(chatSessionId, projectMainMessagesFromSnapshotRows(stableRows))
      store.setSessionHydrated(chatSessionId, true)
      store.setPassiveStreamingMessageIds(chatSessionId, [])
      store.clearSessionErrors(chatSessionId)
      store.setSessionMeta(chatSessionId, {
        cancelling: false,
        passiveStatus: derivePassiveStatus(stableRows),
      })

      const failedRow = readLatestFailedMainAssistantRow(stableRows)
      if (failedRow?.errorText) {
        store.failGeneration(failedRow.messageId, failedRow.errorText)
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
    if (passiveStreamRef.current) {
      passiveStreamRef.current.controller.abort()
      passiveStreamRef.current.handler.dispose()
      passiveStreamRef.current = null
    }
    if (chatSessionId) {
      detachPassiveSessionStreamingState(chatSessionId)
    }
    requestedRuntimeActiveRunMessageRef.current = null
    runtimeQueueSignatureRef.current = null
    latestTerminalRunRefreshRef.current = null
  }, [chatSessionId, driverEnabled])

  useLayoutEffect(() => {
    if (!driverEnabled || !chatSessionId || !snapshotRows) {
      return
    }
    const meta = useChatStore.getState().sessionMetaMap.get(chatSessionId)
    if (meta?.locallyDriving) {
      return
    }
    if (passiveStreamRef.current?.sessionId === chatSessionId) {
      return
    }

    const holdEmptyStreamingSnapshot = shouldHoldEmptyStreamingSnapshot({
      rows: snapshotRows,
      runtimeStatusKnown,
      runtimeIdle,
      snapshotFetching: snapshotRowsQuery.isFetching,
    })
    const effectiveRows = holdEmptyStreamingSnapshot
      ? projectRowsWithoutEmptyStreamingAssistant(snapshotRows)
      : snapshotRows
    const projected = projectMainMessagesFromSnapshotRows(effectiveRows)
    const store = useChatStore.getState()
    const existingMessageCount = store.messagesMap.get(chatSessionId)?.length ?? 0
    const snapshotStreamingMessageIds = holdEmptyStreamingSnapshot
      ? []
      : projectStreamingMainAssistantMessageIds(effectiveRows)
    const passiveStreamingMessageIds = runtimeActiveRunMessageId
      ? [runtimeActiveRunMessageId]
      : snapshotStreamingMessageIds
    const passiveStatus = runtimeActiveRunMessageId
      ? 'streaming'
      : holdEmptyStreamingSnapshot
        ? 'idle'
        : derivePassiveStatus(effectiveRows)
    if (!holdEmptyStreamingSnapshot || existingMessageCount === 0) {
      store.setMessages(chatSessionId, projected)
    }
    store.setSessionHydrated(chatSessionId, true)
    store.setPassiveStreamingMessageIds(chatSessionId, passiveStreamingMessageIds)
    store.clearSessionErrors(chatSessionId)
    store.setSessionMeta(chatSessionId, {
      cancelling: meta?.cancelling && passiveStatus === 'streaming',
      passiveStatus,
    })

    const failedRow = readLatestFailedMainAssistantRow(snapshotRows)
    if (failedRow?.errorText) {
      useChatStore.getState().failGeneration(failedRow.messageId, failedRow.errorText)
    }
    if (holdEmptyStreamingSnapshot && runtimeIdle) {
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
    useChatStore.getState().setPassiveStatus(chatSessionId, 'error')
  }, [chatSessionId, driverEnabled, snapshotRowsQuery.isError])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId || !runtimeActiveRun?.messageId) {
      return
    }

    useChatStore.getState().setRunDisplayId(runtimeActiveRun.messageId, runtimeActiveRun.runId)
  }, [chatSessionId, driverEnabled, runtimeActiveRun])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId || !runtimeStatus || runtimeStatus.activeRun) {
      return
    }

    const latestRun = runtimeStatus.latestRun
    if (latestRun?.runId && latestRun.messageId && isTerminalChatRunStatus(latestRun.status)) {
      const snapshotHasMessage = snapshotRows?.some(row => row.messageId === latestRun.messageId) ?? false
      const storeHasMessage = (useChatStore.getState().messagesMap.get(chatSessionId) ?? [])
        .some(message => message.id === latestRun.messageId)
      if (!snapshotHasMessage && !storeHasMessage && latestTerminalRunRefreshRef.current !== latestRun.runId) {
        latestTerminalRunRefreshRef.current = latestRun.runId
        scheduleSnapshotRefresh(0)
      }
    }

    const released = releaseSessionStreamingStateForTerminalRun(chatSessionId, runtimeStatus.latestRun)
    if (released) {
      scheduleSnapshotRefresh(0)
      refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
    }
  }, [chatSessionId, driverEnabled, refreshQueue, runtimeStatus, scheduleSnapshotRefresh, snapshotRows])

  useEffect(() => {
    return () => {
      if (passiveStreamRef.current) {
        const current = passiveStreamRef.current
        current.controller.abort()
        current.handler.dispose()
        passiveStreamRef.current = null
        detachPassiveSessionStreamingState(current.sessionId)
      }
      requestedRuntimeActiveRunMessageRef.current = null
      runtimeQueueSignatureRef.current = null
      latestTerminalRunRefreshRef.current = null
    }
  }, [chatSessionId])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId || !runtimeStatus) {
      runtimeQueueSignatureRef.current = null
      return
    }

    const queueSignature = [
      runtimeStatus.queue.pending,
      runtimeStatus.queue.running,
      runtimeStatus.pendingQueueItemId ?? '',
      runtimeStatus.activeRun?.queueItemId ?? '',
    ].join(':')
    if (runtimeQueueSignatureRef.current === queueSignature) {
      return
    }
    runtimeQueueSignatureRef.current = queueSignature

    if (
      runtimeStatus.queue.pending > 0
      || runtimeStatus.queue.running > 0
      || runtimeStatus.pendingQueueItemId
      || runtimeStatus.activeRun?.queueItemId
    ) {
      refreshQueue(0)
    }
  }, [chatSessionId, driverEnabled, refreshQueue, runtimeStatus])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId) {
      return
    }

    const activeRunMessageId = runtimeActiveRunMessageId
    if (!activeRunMessageId) {
      requestedRuntimeActiveRunMessageRef.current = null
      return
    }
    const snapshotHasMessage = (snapshotRows ?? []).some(row => row.messageId === activeRunMessageId)
    const storeHasMessage = (useChatStore.getState().messagesMap.get(chatSessionId) ?? []).some(message => message.id === activeRunMessageId)
    if (snapshotHasMessage || storeHasMessage) {
      requestedRuntimeActiveRunMessageRef.current = null
      return
    }
    if (requestedRuntimeActiveRunMessageRef.current === activeRunMessageId) {
      return
    }

    requestedRuntimeActiveRunMessageRef.current = activeRunMessageId
    scheduleSnapshotRefresh(0)
  }, [chatSessionId, driverEnabled, runtimeActiveRunMessageId, scheduleSnapshotRefresh, snapshotRows])

  useEffect(() => {
    if (!driverEnabled || !chatSessionId || (!runtimeActiveRunMessageId && !snapshotRows)) {
      return
    }

    const meta = useChatStore.getState().sessionMetaMap.get(chatSessionId)
    if (meta?.locallyDriving) {
      return
    }

    const holdEmptyStreamingSnapshot = snapshotRows
      ? shouldHoldEmptyStreamingSnapshot({
          rows: snapshotRows,
          runtimeStatusKnown,
          runtimeIdle,
          snapshotFetching: snapshotRowsQuery.isFetching,
        })
      : false
    if (holdEmptyStreamingSnapshot) {
      if (passiveStreamRef.current?.sessionId === chatSessionId) {
        passiveStreamRef.current.controller.abort()
        passiveStreamRef.current.handler.dispose()
        passiveStreamRef.current = null
        detachPassiveSessionStreamingState(chatSessionId)
      }
      return
    }

    const streamingMessageId = runtimeActiveRunMessageId
      ?? (snapshotRows ? projectStreamingMainAssistantMessageIds(snapshotRows)[0] : null)
    if (!streamingMessageId) {
      if (passiveStreamRef.current?.sessionId === chatSessionId) {
        passiveStreamRef.current.controller.abort()
        passiveStreamRef.current.handler.dispose()
        passiveStreamRef.current = null
        detachPassiveSessionStreamingState(chatSessionId)
      }
      return
    }

    const current = passiveStreamRef.current
    if (current?.sessionId === chatSessionId && current.messageId === streamingMessageId) {
      return
    }
    if (current) {
      current.controller.abort()
      current.handler.dispose()
      passiveStreamRef.current = null
      detachPassiveSessionStreamingState(current.sessionId)
    }

    const controller = new AbortController()
    const handler = new ChatStreamingHandler(
      chatSessionId,
      streamingMessageId,
      performance.now(),
      { mode: 'passive', useStoredMessageSnapshot: false },
    )
    handler.start(controller)
    passiveStreamRef.current = {
      sessionId: chatSessionId,
      messageId: streamingMessageId,
      controller,
      handler,
    }

    void (async () => {
      try {
        const transport = await subscribeChatSessionStreamForSession({
          sessionId: chatSessionId,
          signal: controller.signal,
        })
        if (transport.runId) {
          useChatStore.getState().setRunDisplayId(streamingMessageId, transport.runId)
        }

        await handler.consume(transport.stream)
        handler.finish()
      }
      catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          handler.fail(err instanceof Error ? err.message : 'Stream failed')
        }
      }
      finally {
        handler.dispose()
        if (passiveStreamRef.current?.controller === controller) {
          passiveStreamRef.current = null
        }
        scheduleSnapshotRefresh(0)
        refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
      }
    })()

    return undefined
  }, [chatSessionId, driverEnabled, refreshQueue, runtimeActiveRunMessageId, runtimeIdle, runtimeStatusKnown, scheduleSnapshotRefresh, snapshotRows, snapshotRowsQuery.isFetching])
}
