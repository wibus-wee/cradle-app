import type { PersistedThinkingEffort } from '../queue/session-queue'
import type { ChatMessageStatus } from '../run/stream-chunks'
import type { RuntimeSettings } from '../runtime-provider-types'

export const CHAT_SESSION_AGGREGATE_TYPE = 'ChatSession'
export const CHAT_SESSION_EVENT_SCHEMA_VERSION = 3

/**
 * Aggregate event versions are monotonically increasing but NOT contiguous.
 * Legacy checkpoint facts (`AssistantMessageSnapshotted`) may leave holes after
 * purge/filter. Consumers must use `version > lastSeen`, never `version === prev + 1`.
 */
export type ChatSessionEventSchemaVersion = typeof CHAT_SESSION_EVENT_SCHEMA_VERSION

export type TerminalRunEventType = 'RunCompleted' | 'RunFailed' | 'RunAborted'

export type ChatSessionEventType
  = | 'UserMessageAppended'
    | 'MessageImported'
    | 'RunStarted'
    | 'AssistantMessageCompleted'
    | TerminalRunEventType
    | 'InteractionRequested'
    | 'InteractionResolved'
    | 'PlanImplementationResponded'
    | 'QueueItemEnqueued'
    | 'QueueItemClaimed'
    | 'QueueItemReleased'
    | 'QueueItemFailed'
    | 'QueueItemReordered'
    | 'QueueItemUpdated'
    | 'QueueItemProviderTargetCleared'
    | 'QueueItemCancelled'
    | 'SteerApplied'
    | 'LastTurnRolledBack'
    | 'TitleChanged'

/** Legacy event type filtered at the read boundary; never re-emitted as a domain fact. */
export const LEGACY_ASSISTANT_MESSAGE_SNAPSHOTTED_EVENT_TYPE = 'AssistantMessageSnapshotted'

export type QueueProjectionStatus = 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'

export interface ChatSessionEventRow {
  sequenceId: number
  aggregateId: string
  aggregateType: string
  version: number
  eventType: string
  payload: string
  subjectRunId: string | null
  occurredAt: number
}

export interface VersionedChatSessionPayload {
  v?: ChatSessionEventSchemaVersion
}

export interface MessageRecordedFact {
  id: string
  sessionId: string
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
  role: 'user' | 'assistant'
  status: ChatMessageStatus
  content: string
  messageJson: string
  errorText?: string | null
  createdAt: number
  updatedAt: number
}

export interface BackendRunStartedFact {
  id: string
  bindingId: string | null
  chatSessionId: string
  messageId: string | null
  origin: 'user' | 'issue-agent' | 'system'
  status: 'streaming'
  stopReason: null
  errorText: null
  startedAt: number
  finishedAt: null
}

export interface QueueItemFact {
  id: string
  sessionId: string
  mode: 'queue'
  status: QueueProjectionStatus
  text: string
  filesJson: string
  contextPartsJson: string
  providerTargetId: string | null
  modelId: string | null
  thinkingEffort: PersistedThinkingEffort | null
  runtimeSettingsJson: string
  position: number
  sourceRunId: string | null
  startedRunId: string | null
  errorText: string | null
  createdAt: number
  updatedAt: number
}

export interface UserMessageAppendedPayload extends VersionedChatSessionPayload {
  message: MessageRecordedFact & { role: 'user', status: 'complete' }
}

export interface MessageImportedPayload extends VersionedChatSessionPayload {
  message: MessageRecordedFact & { status: 'complete' }
}

export interface RunStartedPayload extends VersionedChatSessionPayload {
  run: BackendRunStartedFact
  assistantMessage?: (MessageRecordedFact & { role: 'assistant', status: 'streaming' }) | null
  queueItemId?: string | null
  runtimeSettings?: RuntimeSettings
}

export interface AssistantMessageCompletedPayload extends VersionedChatSessionPayload {
  message: {
    id: string
    sessionId: string
    content: string
    messageJson: string
    status: ChatMessageStatus
    errorText: string | null
    updatedAt: number
  }
}

export interface RunTerminalPayload extends VersionedChatSessionPayload {
  runId: string
  sessionId: string
  queueItemId?: string | null
  bindingId?: string | null
  status: Exclude<ChatMessageStatus, 'streaming'>
  stopReason: string
  errorText: string | null
  finishedAt: number
}

export interface QueueItemEnqueuedPayload extends VersionedChatSessionPayload {
  item: QueueItemFact
}

export interface QueueItemClaimedPayload extends VersionedChatSessionPayload {
  queueItemId: string
  sessionId: string
  startedRunId?: string | null
  updatedAt: number
}

export interface QueueItemReleasedPayload extends VersionedChatSessionPayload {
  queueItemId: string
  sessionId: string
  updatedAt: number
}

export interface QueueItemFailedPayload extends VersionedChatSessionPayload {
  queueItemId: string
  sessionId: string
  errorText: string | null
  updatedAt: number
}

export interface QueueItemReorderedPayload extends VersionedChatSessionPayload {
  queueItemId: string
  sessionId: string
  position: number
  updatedAt: number
}

export interface QueueItemUpdatedPayload extends VersionedChatSessionPayload {
  queueItemId: string
  sessionId: string
  text: string
  filesJson: string
  contextPartsJson: string
  providerTargetId: string | null
  modelId: string | null
  thinkingEffort: PersistedThinkingEffort | null
  runtimeSettingsJson: string
  updatedAt: number
}

export interface QueueItemProviderTargetClearedPayload extends VersionedChatSessionPayload {
  queueItemId: string
  sessionId: string
  providerTargetId: string
  updatedAt: number
}

export interface QueueItemCancelledPayload extends VersionedChatSessionPayload {
  queueItemId: string
  sessionId: string
  updatedAt: number
}

export interface SteerAppliedPayload extends VersionedChatSessionPayload {
  message: MessageRecordedFact & { role: 'user', status: 'complete' }
}

export interface LastTurnRolledBackPayload extends VersionedChatSessionPayload {
  sessionId: string
  messageIds: string[]
  providerRuntimeKind: string
  providerSessionId: string | null
  providerRolledBackTurns: number
  fileChangesReverted: false
  updatedAt: number
}

export interface TitleChangedPayload extends VersionedChatSessionPayload {
  sessionId: string
  title: string
  titleSource: 'provider' | 'user'
  updatedAt: number
}

export interface InteractionRequestedPayload extends VersionedChatSessionPayload {
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

export interface InteractionResolvedPayload extends VersionedChatSessionPayload {
  sessionId: string
  runId: string
  requestId: string
  interactionKind: 'toolApproval' | 'userInput'
  resolution: 'submitted' | 'cancelled'
  approved: boolean | null
  updatedAt: number
}

export interface PlanImplementationRespondedPayload extends VersionedChatSessionPayload {
  sessionId: string
  messageId: string
  approvalId: string
  approved: boolean
  updatedAt: number
}

export type ChatSessionEvent
  = | { type: 'UserMessageAppended', payload: UserMessageAppendedPayload }
    | { type: 'MessageImported', payload: MessageImportedPayload }
    | { type: 'RunStarted', payload: RunStartedPayload }
    | { type: 'AssistantMessageCompleted', payload: AssistantMessageCompletedPayload }
    | { type: 'RunCompleted', payload: RunTerminalPayload }
    | { type: 'RunFailed', payload: RunTerminalPayload }
    | { type: 'RunAborted', payload: RunTerminalPayload }
    | { type: 'InteractionRequested', payload: InteractionRequestedPayload }
    | { type: 'InteractionResolved', payload: InteractionResolvedPayload }
    | { type: 'PlanImplementationResponded', payload: PlanImplementationRespondedPayload }
    | { type: 'QueueItemEnqueued', payload: QueueItemEnqueuedPayload }
    | { type: 'QueueItemClaimed', payload: QueueItemClaimedPayload }
    | { type: 'QueueItemReleased', payload: QueueItemReleasedPayload }
    | { type: 'QueueItemFailed', payload: QueueItemFailedPayload }
    | { type: 'QueueItemReordered', payload: QueueItemReorderedPayload }
    | { type: 'QueueItemUpdated', payload: QueueItemUpdatedPayload }
    | { type: 'QueueItemProviderTargetCleared', payload: QueueItemProviderTargetClearedPayload }
    | { type: 'QueueItemCancelled', payload: QueueItemCancelledPayload }
    | { type: 'SteerApplied', payload: SteerAppliedPayload }
    | { type: 'LastTurnRolledBack', payload: LastTurnRolledBackPayload }
    | { type: 'TitleChanged', payload: TitleChangedPayload }

export type StoredChatSessionEvent
  = Omit<ChatSessionEventRow, 'eventType' | 'payload'>
    & ChatSessionEvent

type V1RunStartedPayload = Omit<RunStartedPayload, 'v'> & {
  assistantMessageProjection?: 'insert' | 'update' | null
}

export function isLegacyAssistantMessageSnapshottedRow(row: ChatSessionEventRow): boolean {
  return row.eventType === LEGACY_ASSISTANT_MESSAGE_SNAPSHOTTED_EVENT_TYPE
}

export function serializeChatSessionEventPayload(event: ChatSessionEvent): string {
  return JSON.stringify(addCurrentPayloadVersion(event.payload))
}

export function parseStoredChatSessionEvent(row: ChatSessionEventRow): StoredChatSessionEvent {
  const type = row.eventType as ChatSessionEventType
  return {
    ...row,
    type,
    payload: upcastChatSessionEventPayload(type, JSON.parse(row.payload)),
  } as StoredChatSessionEvent
}

/**
 * Upcast stored payload JSON to the current schema version.
 * Legacy `AssistantMessageSnapshotted` rows are filtered before this is called
 * (`readSessionEvents` / event-tail read paths); do not reintroduce that type here.
 */
export function upcastChatSessionEventPayload(
  eventType: ChatSessionEventType,
  rawPayload: ChatSessionEvent['payload'],
): ChatSessionEvent['payload'] {
  if (rawPayload.v === CHAT_SESSION_EVENT_SCHEMA_VERSION) {
    return rawPayload
  }
  // v2 payloads are structurally compatible with v3 (snapshot event removed from the union).
  if (rawPayload.v === 2) {
    return addCurrentPayloadVersion(rawPayload)
  }
  if (rawPayload.v !== undefined) {
    throw new Error(`Unsupported chat session event payload version: ${rawPayload.v}`)
  }

  return upcastV1ChatSessionEventPayload(eventType, rawPayload)
}

function upcastV1ChatSessionEventPayload(
  eventType: ChatSessionEventType,
  payload: ChatSessionEvent['payload'],
): ChatSessionEvent['payload'] {
  if (eventType === 'RunStarted') {
    const {
      assistantMessageProjection: _assistantMessageProjection,
      ...rest
    } = payload as V1RunStartedPayload
    return addCurrentPayloadVersion(rest)
  }

  return addCurrentPayloadVersion(payload)
}

function addCurrentPayloadVersion<TPayload extends ChatSessionEvent['payload']>(
  payload: TPayload,
): TPayload & { v: ChatSessionEventSchemaVersion } {
  return {
    ...payload,
    v: CHAT_SESSION_EVENT_SCHEMA_VERSION,
  }
}
