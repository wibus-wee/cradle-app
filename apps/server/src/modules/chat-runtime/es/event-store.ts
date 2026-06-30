import { sessionEvents } from '@cradle/db'
import { desc, eq } from 'drizzle-orm'

import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import {
  CHAT_SESSION_AGGREGATE_TYPE,
  type ChatSessionEvent,
  type StoredChatSessionEvent,
  parseStoredChatSessionEvent
} from './events'

type ChatRuntimeDb = ReturnType<typeof db>
export type ChatRuntimeTx = Parameters<Parameters<ChatRuntimeDb['transaction']>[0]>[0]
export type ChatRuntimeWriteDb = ChatRuntimeDb | ChatRuntimeTx

export interface AppendSessionEventInput {
  aggregateId: string
  event: ChatSessionEvent
  occurredAt?: number
}

export function readNextSessionEventVersion(
  d: Pick<ChatRuntimeWriteDb, 'select'>,
  aggregateId: string
): number {
  const latest = d
    .select({ version: sessionEvents.version })
    .from(sessionEvents)
    .where(eq(sessionEvents.aggregateId, aggregateId))
    .orderBy(desc(sessionEvents.version))
    .limit(1)
    .get()
  return (latest?.version ?? 0) + 1
}

export function appendSessionEvent(
  d: Pick<ChatRuntimeWriteDb, 'select' | 'insert'>,
  input: AppendSessionEventInput
): StoredChatSessionEvent {
  const version = readNextSessionEventVersion(d, input.aggregateId)
  const row = d
    .insert(sessionEvents)
    .values({
      aggregateId: input.aggregateId,
      aggregateType: CHAT_SESSION_AGGREGATE_TYPE,
      version,
      eventType: input.event.type,
      payload: JSON.stringify(input.event.payload),
      occurredAt: input.occurredAt ?? currentUnixSeconds()
    })
    .returning()
    .get()
  return parseStoredChatSessionEvent(row)
}

export function readSessionEvents(aggregateId: string): StoredChatSessionEvent[] {
  return db()
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.aggregateId, aggregateId))
    .orderBy(sessionEvents.version)
    .all()
    .map(parseStoredChatSessionEvent)
}
