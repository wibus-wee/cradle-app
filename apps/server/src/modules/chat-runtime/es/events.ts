import type {
  ChatSessionQueueItem,
  Message,
  NewBackendRun,
  NewChatSessionQueueItem,
  NewMessage,
  SessionEvent
} from '@cradle/db'

import type { ChatMessageStatus } from '../run/stream-chunks'
import type { ChatRuntimeSettings } from '../runtime-provider-types'
import type { PersistedThinkingEffort } from '../queue/session-queue'

export const CHAT_SESSION_AGGREGATE_TYPE = 'ChatSession'

export type TerminalRunEventType = 'RunCompleted' | 'RunFailed' | 'RunAborted'

export type ChatSessionEventType =
  | 'UserMessageAppended'
  | 'RunStarted'
  | 'AssistantMessageCompleted'
  | TerminalRunEventType
  | 'InteractionRequested'
  | 'InteractionResolved'
  | 'QueueItemEnqueued'
  | 'QueueItemClaimed'
  | 'QueueItemReleased'
  | 'QueueItemFailed'
  | 'QueueItemReordered'
  | 'QueueItemUpdated'
  | 'QueueItemCancelled'
  | 'SteerApplied'
  | 'LastTurnRolledBack'
  | 'TitleChanged'

export type QueueProjectionStatus = ChatSessionQueueItem['status']

export interface UserMessageAppendedPayload {
  message: NewMessage & { id: string; sessionId: string }
}

export interface RunStartedPayload {
  run: NewBackendRun & { id: string; chatSessionId: string; startedAt: number }
  assistantMessage?: (NewMessage & { id: string; sessionId: string }) | null
  assistantMessageProjection?: 'insert' | 'update' | null
  queueItemId?: string | null
  runtimeSettings?: ChatRuntimeSettings
}

export interface AssistantMessageCompletedPayload {
  message: Pick<Message, 'id' | 'sessionId' | 'content' | 'messageJson'> & {
    status: ChatMessageStatus
    errorText: string | null
    updatedAt: number
  }
}

export interface RunTerminalPayload {
  runId: string
  sessionId: string
  queueItemId?: string | null
  bindingId?: string | null
  status: Exclude<ChatMessageStatus, 'streaming'>
  stopReason: string
  errorText: string | null
  finishedAt: number
}

export interface QueueItemEnqueuedPayload {
  item: NewChatSessionQueueItem & {
    id: string
    sessionId: string
    createdAt: number
    updatedAt: number
  }
}

export interface QueueItemClaimedPayload {
  queueItemId: string
  sessionId: string
  startedRunId?: string | null
  updatedAt: number
}

export interface QueueItemReleasedPayload {
  queueItemId: string
  sessionId: string
  updatedAt: number
}

export interface QueueItemFailedPayload {
  queueItemId: string
  sessionId: string
  errorText: string | null
  updatedAt: number
}

export interface QueueItemReorderedPayload {
  queueItemId: string
  sessionId: string
  position: number
  updatedAt: number
}

export interface QueueItemUpdatedPayload {
  queueItemId: string
  sessionId: string
  text: string
  filesJson: string
  contextPartsJson: string
  providerTargetId: string | null
  modelId: string | null
  thinkingEffort: PersistedThinkingEffort | null
  runtimeAccessMode: ChatRuntimeSettings['accessMode']
  runtimeInteractionMode: ChatRuntimeSettings['interactionMode']
  updatedAt: number
}

export interface QueueItemCancelledPayload {
  queueItemId: string
  sessionId: string
  updatedAt: number
}

export interface SteerAppliedPayload {
  message: NewMessage & { id: string; sessionId: string }
}

export interface LastTurnRolledBackPayload {
  sessionId: string
  messageIds: string[]
  providerRuntimeKind: string
  providerSessionId: string | null
  providerRolledBackTurns: number
  fileChangesReverted: false
  updatedAt: number
}

export interface TitleChangedPayload {
  sessionId: string
  title: string
  titleSource: 'provider' | 'user'
  updatedAt: number
}

export interface InteractionRequestedPayload {
  sessionId: string
  runId: string
  requestId: string
  interactionKind: 'toolApproval' | 'userInput'
  providerKind: string
  runtimeKind: string
  providerMethod: string
  toolCallId: string
  questionCount: number | null
  createdAt: number
  updatedAt: number
}

export interface InteractionResolvedPayload {
  sessionId: string
  runId: string
  requestId: string
  interactionKind: 'toolApproval' | 'userInput'
  resolution: 'submitted' | 'cancelled'
  approved: boolean | null
  updatedAt: number
}

export type ChatSessionEvent =
  | { type: 'UserMessageAppended'; payload: UserMessageAppendedPayload }
  | { type: 'RunStarted'; payload: RunStartedPayload }
  | { type: 'AssistantMessageCompleted'; payload: AssistantMessageCompletedPayload }
  | { type: TerminalRunEventType; payload: RunTerminalPayload }
  | { type: 'InteractionRequested'; payload: InteractionRequestedPayload }
  | { type: 'InteractionResolved'; payload: InteractionResolvedPayload }
  | { type: 'QueueItemEnqueued'; payload: QueueItemEnqueuedPayload }
  | { type: 'QueueItemClaimed'; payload: QueueItemClaimedPayload }
  | { type: 'QueueItemReleased'; payload: QueueItemReleasedPayload }
  | { type: 'QueueItemFailed'; payload: QueueItemFailedPayload }
  | { type: 'QueueItemReordered'; payload: QueueItemReorderedPayload }
  | { type: 'QueueItemUpdated'; payload: QueueItemUpdatedPayload }
  | { type: 'QueueItemCancelled'; payload: QueueItemCancelledPayload }
  | { type: 'SteerApplied'; payload: SteerAppliedPayload }
  | { type: 'LastTurnRolledBack'; payload: LastTurnRolledBackPayload }
  | { type: 'TitleChanged'; payload: TitleChangedPayload }

export type StoredChatSessionEvent = Omit<SessionEvent, 'eventType' | 'payload'> & ChatSessionEvent

export function parseStoredChatSessionEvent(row: SessionEvent): StoredChatSessionEvent {
  return {
    ...row,
    type: row.eventType as ChatSessionEventType,
    payload: JSON.parse(row.payload) as ChatSessionEvent['payload']
  } as StoredChatSessionEvent
}
