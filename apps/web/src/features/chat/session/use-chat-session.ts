import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import {
  runtimeCatalogItemHasSlotName,
  useRuntimeCatalog,
} from '~/features/agent-runtime/use-runtime-catalog'
import { chatSelectors, useChatStore } from '~/store/chat'

import { listChatSessionQueue } from '../commands/chat-response-command'
import { runtimeSupportsCodexGoalBridge } from '../runtime/codex-app-server-bridge'
import { useRuntimeSessionStatus } from '../runtime/use-runtime-session-status'
import { useChatActions } from './use-chat-actions'
import { useChatQueue } from './use-chat-queue'
import { useChatSessionRuntimeControls } from './use-chat-session-runtime-controls'
import { EMPTY_QUEUE_ITEMS } from './use-chat-session-types'
import { useSessionBinding } from './use-session-binding'

// Re-export types and utilities for public API compatibility
export type {
  ChatContinuationMode,
  ChatQueueItem,
  ChatSessionMessageRow,
  RuntimeUserInputSubmitInput,
  SendMessageOptions,
  SendMessageResult,
  ToolApprovalResponseInput,
} from './use-chat-session-types'
export { projectMainMessagesFromSnapshotRows } from './use-chat-session-types'

// ── Facade Hook ────────────────────────────────────────────

export function useChatSession(chatSessionId: string | null, active = true) {
  const controls = useChatSessionRuntimeControls(chatSessionId)
  const { queueQueryKey } = controls
  const queryEnabled = active && !!chatSessionId

  const messageIds = useChatStore(
    useShallow(chatSelectors.messageIds(chatSessionId ?? '')),
  )
  const visibleStatus = useChatStore(
    chatSelectors.visibleStatus(chatSessionId ?? ''),
  )
  const isStreaming = useChatStore(
    chatSelectors.isSessionStreaming(chatSessionId ?? ''),
  )
  const isHydrated = useChatStore(
    chatSessionId ? chatSelectors.isSessionHydrated(chatSessionId) : () => true,
  )

  const latestError = useChatStore(
    chatSessionId ? chatSelectors.latestError(chatSessionId) : () => undefined,
  )
  const queueQuery = useQuery({
    queryKey: queueQueryKey,
    queryFn: () => listChatSessionQueue(chatSessionId!),
    enabled: queryEnabled,
    refetchInterval: false,
  })
  const runtimeStatusQuery = useRuntimeSessionStatus(queryEnabled ? chatSessionId : null, queryEnabled, {
    refetchInterval: false,
  })
  const runtimeStatus = runtimeStatusQuery.data
  const sessionBinding = useSessionBinding(chatSessionId, queryEnabled)
  const runtimeKind = runtimeStatus?.runtimeKind ?? sessionBinding?.runtimeKind ?? null
  const { runtimes } = useRuntimeCatalog()
  const runtimeDescriptor = useMemo(
    () => runtimes.find(runtime => runtime.runtimeKind === runtimeKind) ?? null,
    [runtimeKind, runtimes],
  )
  const supportsGoalCommand = runtimeCatalogItemHasSlotName(runtimeDescriptor, 'goal', 'slashCommand')
  const supportsCodexGoalBridge = runtimeSupportsCodexGoalBridge(runtimeDescriptor)

  const { sendMessage, respondToToolApproval, submitPendingUserInput, rollbackLastTurn, stop } = useChatActions({
    chatSessionId,
    controls,
    runtimeStatus,
    supportsGoalCommand,
    supportsCodexGoalBridge,
  })

  const { cancelQueueItem, reorderQueueItems, updateQueueItem } = useChatQueue(chatSessionId, controls)

  // ── isReady (always true once hydrated) ──

  const messageCount = messageIds.length
  const isReady = messageCount > 0 || isHydrated || chatSessionId === null
  const serverBusy = Boolean(
    runtimeStatus
    && (
      runtimeStatus.status === 'streaming'
      || runtimeStatus.status === 'pending'
      || runtimeStatus.status === 'cancelling'
      || runtimeStatus.activeRun
    ),
  )
  const serverStopAvailable = Boolean(runtimeStatus && (runtimeStatus.status === 'streaming' || runtimeStatus.activeRun))

  // Last-turn rollback is only available on runtimes that declare support, and
  // only when the session is idle with no active/pending/running work — the
  // server enforces the same preconditions, but gating here keeps the entry
  // point from offering a no-op (or a guaranteed 409) while busy.
  const supportsLastTurnRollback = Boolean(runtimeStatus?.supportsLastTurnRollback)
  const rollbackQueueIdle = runtimeStatus
    ? runtimeStatus.queue.pending === 0 && runtimeStatus.queue.running === 0
    : false
  const canRollbackLastTurn
    = supportsLastTurnRollback
      && Boolean(runtimeStatus)
      && !serverBusy
      && !isStreaming
      && runtimeStatus!.status === 'idle'
      && rollbackQueueIdle
      && messageCount > 0

  useEffect(() => {
    if (latestError) {
      console.error(`[useChatSession] error for session ${chatSessionId}:`, latestError)
    }
  }, [chatSessionId, latestError])

  return {
    messageIds,
    messageCount,
    status: visibleStatus,
    isStreaming,
    isBusy: serverBusy || isStreaming,
    canStop: serverStopAvailable || isStreaming,
    error: latestError?.message,
    sendMessage,
    respondToToolApproval,
    submitPendingUserInput,
    stop,
    rollback: {
      supported: supportsLastTurnRollback,
      canRollback: canRollbackLastTurn,
      rollback: rollbackLastTurn,
    },
    isReady,
    queueItems: queueQuery.data?.items ?? EMPTY_QUEUE_ITEMS,
    cancelQueueItem,
    reorderQueueItems,
    updateQueueItem,
  }
}
