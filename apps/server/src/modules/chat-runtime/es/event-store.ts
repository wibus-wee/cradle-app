import { sessionEvents } from '@cradle/db'
import { desc, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import type { ChatSessionEvent, StoredChatSessionEvent } from './events'
import {
  CHAT_SESSION_AGGREGATE_TYPE,
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
  d: Pick<ChatRuntimeWriteDb, 'select' | 'insert'>,
  input: AppendSessionEventInput,
): StoredChatSessionEvent {
  const currentVersion = readCurrentSessionEventVersion(d, input.aggregateId)
  if (input.expectedVersion !== undefined && currentVersion !== input.expectedVersion) {
    throwConcurrencyConflict(input.aggregateId, input.expectedVersion, currentVersion)
  }

  const version = currentVersion + 1
  let row
  try {
    row = d
      .insert(sessionEvents)
      .values({
        aggregateId: input.aggregateId,
        aggregateType: CHAT_SESSION_AGGREGATE_TYPE,
        version,
        eventType: input.event.type,
        payload: serializeChatSessionEventPayload(input.event),
        occurredAt: input.occurredAt ?? currentUnixSeconds(),
      })
      .returning()
      .get()
  }
 catch {
    throwConcurrencyConflict(input.aggregateId, input.expectedVersion ?? currentVersion, currentVersion)
  }
  return parseStoredChatSessionEvent(row)
}

export function readSessionEvents(
  aggregateId: string,
  d: Pick<ChatRuntimeWriteDb, 'select'> = db(),
): StoredChatSessionEvent[] {
  return d
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.aggregateId, aggregateId))
    .orderBy(sessionEvents.version)
    .all()
    .map(parseStoredChatSessionEvent)
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
