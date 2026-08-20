import { sessionEvents } from '@cradle/db'
import { desc, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import { putMessagePayload, readMessagePayload } from '../message-payload-store'
import type {
  ChatSessionEvent,
  ChatSessionHeaderEvent,
  StoredChatSessionEvent,
} from './events'
import {
  CHAT_SESSION_AGGREGATE_TYPE,
  isLegacyAssistantMessageSnapshottedRow,
  parseChatSessionEventHeader,
  parseStoredChatSessionEvent,
  serializeChatSessionEventPayload,
} from './events'

type ChatRuntimeDb = ReturnType<typeof db>
export type ChatRuntimeTx = Parameters<Parameters<ChatRuntimeDb['transaction']>[0]>[0]
export type ChatRuntimeWriteDb = ChatRuntimeDb | ChatRuntimeTx

export interface AppendSessionEventInput {
  aggregateId: string
  event: ChatSessionEvent
  expectedVersion?: number
  occurredAt?: number
}

export interface AppendSessionEventsInput {
  aggregateId: string
  events: ChatSessionEvent[]
  expectedVersion?: number
  /** Version read earlier inside the same caller-owned transaction. */
  knownCurrentVersion?: number
  occurredAt?: number
}

const SESSION_EVENT_INSERT_BATCH_SIZE = 100

export function readCurrentSessionEventVersion(
  d: Pick<ChatRuntimeWriteDb, 'select'>,
  aggregateId: string,
): number {
  const latest = d
    .select({ version: sessionEvents.version })
    .from(sessionEvents)
    .where(eq(sessionEvents.aggregateId, aggregateId))
    .orderBy(desc(sessionEvents.version))
    .limit(1)
    .get()
  return latest?.version ?? 0
}

export function readNextSessionEventVersion(
  d: Pick<ChatRuntimeWriteDb, 'select'>,
  aggregateId: string,
): number {
  return readCurrentSessionEventVersion(d, aggregateId) + 1
}

export function appendSessionEvent(
  d: Pick<ChatRuntimeWriteDb, 'select' | 'insert' | 'update'>,
  input: AppendSessionEventInput,
): StoredChatSessionEvent {
  return appendSessionEvents(d, {
    aggregateId: input.aggregateId,
    events: [input.event],
    expectedVersion: input.expectedVersion,
    occurredAt: input.occurredAt,
  })[0]!
}

/**
 * Allocate versions once and append a command's facts in bounded multi-row
 * inserts. Callers own the surrounding transaction so a later chunk failure
 * rolls back the entire logical append.
 */
export function appendSessionEvents(
  d: Pick<ChatRuntimeWriteDb, 'select' | 'insert' | 'update'>,
  input: AppendSessionEventsInput,
): StoredChatSessionEvent[] {
  if (input.events.length === 0) {
    return []
  }
  const currentVersion = input.knownCurrentVersion
    ?? readCurrentSessionEventVersion(d, input.aggregateId)
  if (input.expectedVersion !== undefined && currentVersion !== input.expectedVersion) {
    throwConcurrencyConflict(input.aggregateId, input.expectedVersion, currentVersion)
  }

  for (const event of input.events) {
    persistEventMessagePayloads(d, event)
  }
  const occurredAt = input.occurredAt ?? currentUnixSeconds()
  const rows = input.events.map((event, index) => ({
    aggregateId: input.aggregateId,
    aggregateType: CHAT_SESSION_AGGREGATE_TYPE,
    version: currentVersion + index + 1,
    eventType: event.type,
    payload: serializeChatSessionEventPayload(event),
    occurredAt,
  }))
  const storedRows: Array<typeof sessionEvents.$inferSelect> = []
  try {
    for (let offset = 0; offset < rows.length; offset += SESSION_EVENT_INSERT_BATCH_SIZE) {
      storedRows.push(...d
        .insert(sessionEvents)
        .values(rows.slice(offset, offset + SESSION_EVENT_INSERT_BATCH_SIZE))
        .returning()
        .all())
    }
  }
  catch {
    const actualVersion = readCurrentSessionEventVersion(d, input.aggregateId)
    throwConcurrencyConflict(
      input.aggregateId,
      input.expectedVersion ?? currentVersion,
      actualVersion,
    )
  }
  return storedRows.map(row =>
    parseStoredChatSessionEvent(row, payloadId => readMessagePayload(d, payloadId)))
}

export function readSessionEvents(
  aggregateId: string,
  d: Pick<ChatRuntimeWriteDb, 'select'> = db(),
): StoredChatSessionEvent[] {
  // Filter legacy AssistantMessageSnapshotted rows at the read boundary so
  // reducers/projectors/tail never see checkpoint-masquerading-as-fact events.
  // Aggregate versions remain monotonic but may have holes after purge/filter.
  return d
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.aggregateId, aggregateId))
    .orderBy(sessionEvents.version)
    .all()
    .filter(row => !isLegacyAssistantMessageSnapshottedRow(row))
    .map(row => parseStoredChatSessionEvent(row, payloadId => readMessagePayload(d, payloadId)))
}

/**
 * Shell/history-only event reader. It deliberately leaves message bodies in
 * `chat_message_payloads` and returns payload references instead.
 */
export function readSessionEventHeaders(
  aggregateId: string,
  d: Pick<ChatRuntimeWriteDb, 'select'> = db(),
): ChatSessionHeaderEvent[] {
  return d
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.aggregateId, aggregateId))
    .orderBy(sessionEvents.version)
    .all()
    .filter(row => !isLegacyAssistantMessageSnapshottedRow(row))
    .map(parseChatSessionEventHeader)
}

function persistEventMessagePayloads(
  d: Pick<ChatRuntimeWriteDb, 'insert' | 'select' | 'update'>,
  event: ChatSessionEvent,
): void {
  switch (event.type) {
    case 'UserMessageAppended':
    case 'MessageImported':
    case 'SteerApplied':
      putMessagePayload(d, event.payload.message)
      break
    case 'RunStarted':
      if (event.payload.assistantMessage) {
        putMessagePayload(d, event.payload.assistantMessage)
      }
      break
    case 'AssistantMessageCompleted':
      putMessagePayload(d, {
        ...event.payload.message,
        createdAt: event.payload.message.updatedAt,
      })
      break
    default:
      break
  }
}

function throwConcurrencyConflict(
  aggregateId: string,
  expectedVersion: number,
  actualVersion: number,
): never {
  throw new AppError({
    code: 'chat_session_concurrency_conflict',
    status: 409,
    message: 'Chat session event stream version changed before append',
    details: {
      kind: 'concurrency_conflict',
      aggregateId,
      expectedVersion,
      actualVersion,
    },
  })
}
