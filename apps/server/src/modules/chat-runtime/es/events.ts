import type { PersistedThinkingEffort } from '../queue/session-queue'
import type { ChatMessageStatus } from '../run/stream-chunks'
import type { RuntimeSettings } from '../runtime-provider-types'

export const CHAT_SESSION_AGGREGATE_TYPE = 'ChatSession'
export const CHAT_SESSION_EVENT_SCHEMA_VERSION = 4

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
    | 'QueueItemCompleted'
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
  mode: 'queue' | 'steer'
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

/** Completes a durable submitted-input row without a dedicated Cradle run. */
export interface QueueItemCompletedPayload extends VersionedChatSessionPayload {
  queueItemId: string
  sessionId: string
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
    | { type: 'QueueItemCompleted', payload: QueueItemCompletedPayload }
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

type StoredMessageReference<TMessage extends MessageRecordedFact = MessageRecordedFact>
  = Omit<TMessage, 'content' | 'messageJson' | 'errorText'> & {
  payloadId: string
}

type StoredAssistantMessageCompletedPayload = Omit<AssistantMessageCompletedPayload, 'message'> & {
  message: Omit<AssistantMessageCompletedPayload['message'], 'content' | 'messageJson' | 'errorText'> & {
    payloadId: string
  }
}

type StoredRunStartedPayload = Omit<RunStartedPayload, 'assistantMessage'> & {
  assistantMessage?: StoredMessageReference<
    MessageRecordedFact & { role: 'assistant', status: 'streaming' }
  > | null
}

type StoredUserMessageAppendedPayload = Omit<UserMessageAppendedPayload, 'message'> & {
  message: StoredMessageReference<UserMessageAppendedPayload['message']>
}

type StoredMessageImportedPayload = Omit<MessageImportedPayload, 'message'> & {
  message: StoredMessageReference<MessageImportedPayload['message']>
}

type StoredSteerAppliedPayload = Omit<SteerAppliedPayload, 'message'> & {
  message: StoredMessageReference<SteerAppliedPayload['message']>
}

type StoredChatSessionPayloadV4
  = | StoredUserMessageAppendedPayload
    | StoredMessageImportedPayload
    | StoredSteerAppliedPayload
    | StoredRunStartedPayload
    | StoredAssistantMessageCompletedPayload
    | ChatSessionEvent['payload']

export interface ResolvedMessagePayload {
  id: string
  sessionId: string
  content: string
  messageJson: string
  errorText: string | null
}

export type MessagePayloadResolver = (payloadId: string) => ResolvedMessagePayload | undefined

export function isLegacyAssistantMessageSnapshottedRow(row: ChatSessionEventRow): boolean {
  return row.eventType === LEGACY_ASSISTANT_MESSAGE_SNAPSHOTTED_EVENT_TYPE
}

export function serializeChatSessionEventPayload(event: ChatSessionEvent): string {
  return JSON.stringify(toStoredChatSessionPayload(event))
}

export function parseStoredChatSessionEvent(
  row: ChatSessionEventRow,
  resolveMessagePayload?: MessagePayloadResolver,
): StoredChatSessionEvent {
  const type = row.eventType as ChatSessionEventType
  const rawPayload = JSON.parse(row.payload) as StoredChatSessionPayloadV4
  return {
    ...row,
    type,
    payload: rawPayload.v === CHAT_SESSION_EVENT_SCHEMA_VERSION
      ? hydrateStoredChatSessionPayload(type, rawPayload, resolveMessagePayload)
      : upcastChatSessionEventPayload(type, rawPayload as ChatSessionEvent['payload']),
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
  // v2 and v3 payloads are structurally compatible with the runtime event shape.
  // v4 changes only the stored representation of message-bearing events.
  if (rawPayload.v === 2 || rawPayload.v === 3) {
    return addCurrentPayloadVersion(rawPayload)
  }
  if (rawPayload.v !== undefined) {
    throw new Error(`Unsupported chat session event payload version: ${rawPayload.v}`)
  }

  return upcastV1ChatSessionEventPayload(eventType, rawPayload)
}

function toStoredChatSessionPayload(event: ChatSessionEvent): StoredChatSessionPayloadV4 {
  switch (event.type) {
    case 'UserMessageAppended':
      return {
        ...event.payload,
        message: toStoredMessageReference(event.payload.message),
        v: CHAT_SESSION_EVENT_SCHEMA_VERSION,
      } satisfies StoredUserMessageAppendedPayload
    case 'MessageImported':
      return {
        ...event.payload,
        message: toStoredMessageReference(event.payload.message),
        v: CHAT_SESSION_EVENT_SCHEMA_VERSION,
      } satisfies StoredMessageImportedPayload
    case 'SteerApplied':
      return {
        ...event.payload,
        message: toStoredMessageReference(event.payload.message),
        v: CHAT_SESSION_EVENT_SCHEMA_VERSION,
      } satisfies StoredSteerAppliedPayload
    case 'RunStarted':
      return {
        ...event.payload,
        assistantMessage: event.payload.assistantMessage
          ? toStoredMessageReference(event.payload.assistantMessage)
          : event.payload.assistantMessage,
        v: CHAT_SESSION_EVENT_SCHEMA_VERSION,
      } satisfies StoredRunStartedPayload
    case 'AssistantMessageCompleted':
      return {
        ...event.payload,
        message: {
          id: event.payload.message.id,
          sessionId: event.payload.message.sessionId,
          payloadId: event.payload.message.id,
          status: event.payload.message.status,
          updatedAt: event.payload.message.updatedAt,
        },
        v: CHAT_SESSION_EVENT_SCHEMA_VERSION,
      } satisfies StoredAssistantMessageCompletedPayload
    default:
      return addCurrentPayloadVersion(event.payload)
  }
}

function hydrateStoredChatSessionPayload(
  eventType: ChatSessionEventType,
  payload: StoredChatSessionPayloadV4,
  resolveMessagePayload: MessagePayloadResolver | undefined,
): ChatSessionEvent['payload'] {
  switch (eventType) {
    case 'UserMessageAppended': {
      const stored = payload as StoredUserMessageAppendedPayload
      return {
        ...stored,
        message: hydrateStoredMessageReference(stored.message, resolveMessagePayload),
      } as UserMessageAppendedPayload
    }
    case 'MessageImported': {
      const stored = payload as StoredMessageImportedPayload
      return {
        ...stored,
        message: hydrateStoredMessageReference(stored.message, resolveMessagePayload),
      } as MessageImportedPayload
    }
    case 'SteerApplied': {
      const stored = payload as StoredSteerAppliedPayload
      return {
        ...stored,
        message: hydrateStoredMessageReference(stored.message, resolveMessagePayload),
      } as SteerAppliedPayload
    }
    case 'RunStarted': {
      const stored = payload as StoredRunStartedPayload
      return {
        ...stored,
        assistantMessage: stored.assistantMessage
          ? hydrateStoredMessageReference(stored.assistantMessage, resolveMessagePayload)
          : stored.assistantMessage,
      } as RunStartedPayload
    }
    case 'AssistantMessageCompleted': {
      const stored = payload as StoredAssistantMessageCompletedPayload
      const resolved = requireResolvedMessagePayload(stored.message.payloadId, resolveMessagePayload)
      return {
        ...stored,
        message: {
          id: stored.message.id,
          sessionId: stored.message.sessionId,
          content: resolved.content,
          messageJson: resolved.messageJson,
          status: stored.message.status,
          errorText: resolved.errorText,
          updatedAt: stored.message.updatedAt,
        },
      } as AssistantMessageCompletedPayload
    }
    default:
      return payload as ChatSessionEvent['payload']
  }
}

function toStoredMessageReference<TMessage extends MessageRecordedFact>(
  message: TMessage,
): StoredMessageReference<TMessage> {
  const {
    content: _content,
    messageJson: _messageJson,
    errorText: _errorText,
    ...structural
  } = message
  return {
    ...structural,
    payloadId: message.id,
  } as StoredMessageReference<TMessage>
}

function hydrateStoredMessageReference(
  message: StoredMessageReference,
  resolveMessagePayload: MessagePayloadResolver | undefined,
): MessageRecordedFact {
  const resolved = requireResolvedMessagePayload(message.payloadId, resolveMessagePayload)
  const { payloadId: _payloadId, ...structural } = message
  return {
    ...structural,
    content: resolved.content,
    messageJson: resolved.messageJson,
    errorText: resolved.errorText,
  }
}

function requireResolvedMessagePayload(
  payloadId: string,
  resolveMessagePayload: MessagePayloadResolver | undefined,
): ResolvedMessagePayload {
  const resolved = resolveMessagePayload?.(payloadId)
  if (!resolved) {
    throw new Error(`Chat message payload not found: ${payloadId}`)
  }
  return resolved
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
