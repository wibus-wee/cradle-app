import type { UIMessage } from 'ai'

import type { ChatMessageStatus } from '../run/stream-chunks'
import type { StoredChatSessionEvent } from './events'

export interface ActiveRunFact {
  runId: string
  messageId: string | null
  queueItemId: string | null
  startedAt: number
}

export interface ChatSessionState {
  aggregateId: string
  version: number
  activeRun: ActiveRunFact | null
  messageStatusById: Map<string, ChatMessageStatus>
  assistantMessageById: Map<string, UIMessage>
}

export function reduceChatSessionEvents(events: StoredChatSessionEvent[]): ChatSessionState {
  const state: ChatSessionState = {
    aggregateId: events[0]?.aggregateId ?? '',
    version: 0,
    activeRun: null,
    messageStatusById: new Map(),
    assistantMessageById: new Map()
  }

  for (const event of events) {
    state.aggregateId = event.aggregateId
    state.version = Math.max(state.version, event.version)
    switch (event.type) {
      case 'UserMessageAppended':
      case 'SteerApplied':
        state.messageStatusById.set(event.payload.message.id, 'complete')
        break
      case 'RunStarted':
        state.activeRun = {
          runId: event.payload.run.id,
          messageId: event.payload.run.messageId ?? event.payload.assistantMessage?.id ?? null,
          queueItemId: event.payload.queueItemId ?? null,
          startedAt: event.payload.run.startedAt
        }
        if (event.payload.assistantMessage) {
          state.messageStatusById.set(event.payload.assistantMessage.id, 'streaming')
        }
        break
      case 'AssistantMessageCompleted':
        state.messageStatusById.set(event.payload.message.id, event.payload.message.status)
        try {
          state.assistantMessageById.set(
            event.payload.message.id,
            JSON.parse(event.payload.message.messageJson) as UIMessage
          )
        } catch {
          // Recovery can still terminate the run even if a projection snapshot is malformed.
        }
        break
      case 'RunCompleted':
      case 'RunFailed':
      case 'RunAborted':
        if (state.activeRun?.runId === event.payload.runId) {
          state.activeRun = null
        }
        break
      case 'InteractionRequested':
      case 'InteractionResolved':
        break
      case 'QueueItemEnqueued':
      case 'QueueItemClaimed':
      case 'QueueItemReleased':
      case 'QueueItemFailed':
      case 'QueueItemReordered':
      case 'QueueItemUpdated':
      case 'QueueItemCancelled':
        break
      case 'LastTurnRolledBack':
        for (const messageId of event.payload.messageIds) {
          state.messageStatusById.delete(messageId)
          state.assistantMessageById.delete(messageId)
        }
        if (
          state.activeRun?.messageId &&
          event.payload.messageIds.includes(state.activeRun.messageId)
        ) {
          state.activeRun = null
        }
        break
      case 'TitleChanged':
        break
    }
  }

  return state
}
