import type { ChatSessionState } from './aggregate'
import { createInitialChatSessionState, evolveChatSessionState } from './aggregate'
import type {
  ChatSessionEvent,
  StoredChatSessionEvent,
  TerminalRunEventType,
} from './events'
import { CHAT_SESSION_AGGREGATE_TYPE } from './events'

export type ChatSessionDomainErrorCode
  = | 'run_already_active'
    | 'run_not_active'
    | 'run_message_mismatch'
    | 'queue_item_not_pending'
    | 'rollback_run_active'

export interface ChatSessionDomainError {
  code: ChatSessionDomainErrorCode
  message: string
  details: Record<string, unknown>
}

export type ChatSessionDecisionResult
  = | { ok: true, events: ChatSessionEvent[] }
    | { ok: false, error: ChatSessionDomainError }

export type ChatSessionCommand
  = | { type: 'startRun', event: Extract<ChatSessionEvent, { type: 'RunStarted' }> }
    | { type: 'completeRun', event: Extract<ChatSessionEvent, { type: 'RunCompleted' }> }
    | { type: 'failRun', event: Extract<ChatSessionEvent, { type: 'RunFailed' }> }
    | { type: 'abortRun', event: Extract<ChatSessionEvent, { type: 'RunAborted' }> }
    | { type: 'claimQueueItem', event: Extract<ChatSessionEvent, { type: 'QueueItemClaimed' }> }
    | { type: 'rollbackLastTurn', event: Extract<ChatSessionEvent, { type: 'LastTurnRolledBack' }> }
    | { type: 'recordEvent', event: ChatSessionEvent }

export function decide(
  state: ChatSessionState,
  command: ChatSessionCommand,
): ChatSessionDecisionResult {
  switch (command.type) {
    case 'startRun':
      return decideStartRun(state, command.event)
    case 'completeRun':
    case 'failRun':
    case 'abortRun':
      return decideTerminalRun(state, command.event)
    case 'claimQueueItem':
      return decideClaimQueueItem(state, command.event)
    case 'rollbackLastTurn':
      return decideRollbackLastTurn(state, command.event)
    case 'recordEvent':
      return { ok: true, events: [command.event] }
  }
}

export function decideChatSessionEvents(
  initialState: ChatSessionState,
  events: ChatSessionEvent[],
): ChatSessionDecisionResult {
  const state = cloneChatSessionState(initialState)
  const decidedEvents: ChatSessionEvent[] = []

  for (const event of events) {
    const result = decide(state, commandForEvent(event))
    if (!result.ok) {
      return result
    }
    for (const decidedEvent of result.events) {
      decidedEvents.push(decidedEvent)
      evolveChatSessionState(state, syntheticStoredEvent(state, decidedEvent))
    }
  }

  return { ok: true, events: decidedEvents }
}

function decideStartRun(
  state: ChatSessionState,
  event: Extract<ChatSessionEvent, { type: 'RunStarted' }>,
): ChatSessionDecisionResult {
  if (event.payload.run.origin !== 'system' && state.activeRun) {
    return domainError('run_already_active', 'Chat session already has an active run', {
      activeRunId: state.activeRun.runId,
      runId: event.payload.run.id,
    })
  }

  if (event.payload.queueItemId) {
    const queueItem = state.queueItemById.get(event.payload.queueItemId)
    const isStartableQueueItem
      = queueItem?.status === 'pending'
        || (queueItem?.status === 'running' && queueItem.startedRunId === null)
    if (!isStartableQueueItem) {
      return domainError('queue_item_not_pending', 'Queue item is not pending', {
        queueItemId: event.payload.queueItemId,
        status: queueItem?.status ?? 'missing',
        startedRunId: queueItem?.startedRunId ?? null,
        runId: event.payload.run.id,
      })
    }
  }

  return { ok: true, events: [event] }
}

function decideTerminalRun(
  state: ChatSessionState,
  event: Extract<ChatSessionEvent, { type: TerminalRunEventType }>,
): ChatSessionDecisionResult {
  if (state.runOriginById.get(event.payload.runId) === 'system') {
    return { ok: true, events: [event] }
  }
  if (state.activeRun?.runId !== event.payload.runId) {
    return domainError('run_not_active', 'Terminal run event does not match the active run', {
      activeRunId: state.activeRun?.runId ?? null,
      runId: event.payload.runId,
      eventType: event.type,
    })
  }

  return { ok: true, events: [event] }
}

function decideClaimQueueItem(
  state: ChatSessionState,
  event: Extract<ChatSessionEvent, { type: 'QueueItemClaimed' }>,
): ChatSessionDecisionResult {
  const queueItem = state.queueItemById.get(event.payload.queueItemId)
  if (queueItem?.status !== 'pending') {
    return domainError('queue_item_not_pending', 'Queue item is not pending', {
      queueItemId: event.payload.queueItemId,
      status: queueItem?.status ?? 'missing',
    })
  }

  return { ok: true, events: [event] }
}

function decideRollbackLastTurn(
  state: ChatSessionState,
  event: Extract<ChatSessionEvent, { type: 'LastTurnRolledBack' }>,
): ChatSessionDecisionResult {
  if (state.activeRun) {
    return domainError('rollback_run_active', 'Cannot roll back while a run is active', {
      activeRunId: state.activeRun.runId,
      messageIds: event.payload.messageIds,
    })
  }

  return { ok: true, events: [event] }
}

function commandForEvent(event: ChatSessionEvent): ChatSessionCommand {
  switch (event.type) {
    case 'RunStarted':
      return { type: 'startRun', event }
    case 'RunCompleted':
      return { type: 'completeRun', event }
    case 'RunFailed':
      return { type: 'failRun', event }
    case 'RunAborted':
      return { type: 'abortRun', event }
    case 'QueueItemClaimed':
      return { type: 'claimQueueItem', event }
    case 'LastTurnRolledBack':
      return { type: 'rollbackLastTurn', event }
    default:
      return { type: 'recordEvent', event }
  }
}

function syntheticStoredEvent(
  state: ChatSessionState,
  event: ChatSessionEvent,
): StoredChatSessionEvent {
  return {
    sequenceId: state.version + 1,
    aggregateId: state.aggregateId,
    aggregateType: CHAT_SESSION_AGGREGATE_TYPE,
    version: state.version + 1,
    type: event.type,
    payload: event.payload,
    subjectRunId: readSyntheticSubjectRunId(event),
    occurredAt: 0,
  } as StoredChatSessionEvent
}

function readSyntheticSubjectRunId(event: ChatSessionEvent): string | null {
  switch (event.type) {
    case 'RunStarted':
      return event.payload.run.id
    case 'RunCompleted':
    case 'RunFailed':
    case 'RunAborted':
      return event.payload.runId
    default:
      return null
  }
}

function cloneChatSessionState(state: ChatSessionState): ChatSessionState {
  return {
    aggregateId: state.aggregateId,
    version: state.version,
    activeRun: state.activeRun ? { ...state.activeRun } : null,
    messageStatusById: new Map(state.messageStatusById),
    assistantMessageById: new Map(state.assistantMessageById),
    queueItemById: new Map(
      Array.from(state.queueItemById, ([queueItemId, queueItem]) => [
        queueItemId,
        { ...queueItem },
      ]),
    ),
    runOriginById: new Map(state.runOriginById),
    runMessageIdById: new Map(state.runMessageIdById),
    runStatusById: new Map(state.runStatusById),
  }
}

function domainError(
  code: ChatSessionDomainErrorCode,
  message: string,
  details: Record<string, unknown>,
): ChatSessionDecisionResult {
  return {
    ok: false,
    error: { code, message, details },
  }
}

export function emptyChatSessionDecisionState(aggregateId: string): ChatSessionState {
  return createInitialChatSessionState(aggregateId)
}
