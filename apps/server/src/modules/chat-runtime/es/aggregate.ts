import type { UIMessage } from 'ai'

import type { ChatMessageStatus } from '../run/stream-chunks'
import type { QueueProjectionStatus, StoredChatSessionEvent } from './events'

export interface ActiveRunFact {
  runId: string
  messageId: string | null
  queueItemId: string | null
  startedAt: number
}

export interface QueueItemFactState {
  status: QueueProjectionStatus
  startedRunId: string | null
}

export interface ChatSessionState {
  aggregateId: string
  version: number
  activeRun: ActiveRunFact | null
  messageStatusById: Map<string, ChatMessageStatus>
  assistantMessageById: Map<string, UIMessage>
  queueItemById: Map<string, QueueItemFactState>
  runOriginById: Map<string, 'user' | 'issue-agent' | 'system'>
  runMessageIdById: Map<string, string | null>
  runStatusById: Map<string, ChatMessageStatus>
}

export function createInitialChatSessionState(aggregateId = ''): ChatSessionState {
  return {
    aggregateId,
    version: 0,
    activeRun: null,
    messageStatusById: new Map(),
    assistantMessageById: new Map(),
    queueItemById: new Map(),
    runOriginById: new Map(),
    runMessageIdById: new Map(),
    runStatusById: new Map(),
  }
}

export function reduceChatSessionEvents(events: StoredChatSessionEvent[]): ChatSessionState {
  let state = createInitialChatSessionState(events[0]?.aggregateId ?? '')

  for (const event of events) {
    state = evolveChatSessionState(state, event)
  }

  return state
}

export function evolveChatSessionState(
  state: ChatSessionState,
  event: StoredChatSessionEvent,
): ChatSessionState {
  state.aggregateId = event.aggregateId
  state.version = Math.max(state.version, event.version)
  switch (event.type) {
    case 'UserMessageAppended':
    case 'MessageImported':
    case 'SteerApplied':
      state.messageStatusById.set(event.payload.message.id, 'complete')
      break
    case 'RunStarted':
      state.runOriginById.set(event.payload.run.id, event.payload.run.origin)
      state.runMessageIdById.set(
        event.payload.run.id,
        event.payload.run.messageId ?? event.payload.assistantMessage?.id ?? null,
      )
      state.runStatusById.set(event.payload.run.id, 'streaming')
      if (event.payload.run.origin !== 'system') {
        state.activeRun = {
          runId: event.payload.run.id,
          messageId: event.payload.run.messageId ?? event.payload.assistantMessage?.id ?? null,
          queueItemId: event.payload.queueItemId ?? null,
          startedAt: event.payload.run.startedAt,
        }
      }
      if (event.payload.assistantMessage) {
        state.messageStatusById.set(event.payload.assistantMessage.id, 'streaming')
      }
      if (event.payload.queueItemId) {
        state.queueItemById.set(event.payload.queueItemId, {
          status: 'running',
          startedRunId: event.payload.run.id,
        })
      }
      break
    case 'AssistantMessageCompleted':
      state.messageStatusById.set(event.payload.message.id, event.payload.message.status)
      try {
        state.assistantMessageById.set(
          event.payload.message.id,
          JSON.parse(event.payload.message.messageJson) as UIMessage,
        )
      }
 catch {
        // Recovery can still terminate the run even if a projection snapshot is malformed.
      }
      break
    case 'RunCompleted':
    case 'RunFailed':
    case 'RunAborted':
      state.runStatusById.set(event.payload.runId, event.payload.status)
      if (state.activeRun?.runId === event.payload.runId) {
        state.activeRun = null
      }
      if (event.payload.queueItemId) {
        state.queueItemById.set(event.payload.queueItemId, {
          status:
            event.payload.status === 'complete'
              ? 'completed'
              : event.payload.status === 'aborted'
                ? 'cancelled'
                : 'failed',
          startedRunId: event.payload.runId,
        })
      }
      break
    case 'InteractionRequested':
    case 'InteractionResolved':
    case 'PlanImplementationResponded':
      break
    case 'QueueItemEnqueued':
      state.queueItemById.set(event.payload.item.id, {
        status: event.payload.item.status,
        startedRunId: event.payload.item.startedRunId,
      })
      break
    case 'QueueItemClaimed':
      state.queueItemById.set(event.payload.queueItemId, {
        status: 'running',
        startedRunId: event.payload.startedRunId ?? null,
      })
      break
    case 'QueueItemReleased':
      state.queueItemById.set(event.payload.queueItemId, {
        status: 'pending',
        startedRunId: null,
      })
      break
    case 'QueueItemFailed':
      state.queueItemById.set(event.payload.queueItemId, {
        status: 'failed',
        startedRunId: state.queueItemById.get(event.payload.queueItemId)?.startedRunId ?? null,
      })
      break
    case 'QueueItemReordered':
    case 'QueueItemUpdated':
    case 'QueueItemProviderTargetCleared':
      break
    case 'QueueItemCancelled':
      state.queueItemById.set(event.payload.queueItemId, {
        status: 'cancelled',
        startedRunId: state.queueItemById.get(event.payload.queueItemId)?.startedRunId ?? null,
      })
      break
    case 'LastTurnRolledBack':
      for (const messageId of event.payload.messageIds) {
        state.messageStatusById.delete(messageId)
        state.assistantMessageById.delete(messageId)
      }
      if (
        state.activeRun?.messageId
        && event.payload.messageIds.includes(state.activeRun.messageId)
      ) {
        state.activeRun = null
      }
      break
    case 'TitleChanged':
      break
  }

  return state
}

export const evolve = evolveChatSessionState
