import type { Message, NewMessage } from '@cradle/db'
import { chatMessagePayloads, messages } from '@cradle/db'
import { eq, inArray } from 'drizzle-orm'

import type { ChatRuntimeWriteDb } from './es/event-store'

export interface MessagePayloadSource {
  id: string
  sessionId: string
  content: string
  messageJson: string
  errorText?: string | null
  createdAt: number
  updatedAt: number
}

export interface StoredMessagePayload {
  id: string
  sessionId: string
  content: string
  messageJson: string
  errorText: string | null
  createdAt: number
  updatedAt: number
}

export type HydratedMessage = Message & Pick<
  StoredMessagePayload,
  'content' | 'messageJson' | 'errorText'
>

type MessagePayloadDb = Pick<ChatRuntimeWriteDb, 'insert' | 'select' | 'update'>

export const messagePayloadSelection = {
  content: chatMessagePayloads.content,
  messageJson: chatMessagePayloads.messageJson,
  errorText: chatMessagePayloads.errorText,
}

export function putMessagePayload(d: MessagePayloadDb, source: MessagePayloadSource): void {
  d.insert(chatMessagePayloads)
    .values(toPayloadValues(source))
    .onConflictDoUpdate({
      target: chatMessagePayloads.id,
      set: {
        sessionId: source.sessionId,
        content: source.content,
        messageJson: source.messageJson,
        errorText: source.errorText ?? null,
        updatedAt: source.updatedAt,
      },
    })
    .run()
}

export function updateMessagePayload(
  d: Pick<ChatRuntimeWriteDb, 'update'>,
  source: Omit<MessagePayloadSource, 'createdAt'>,
): void {
  d.update(chatMessagePayloads)
    .set({
      content: source.content,
      messageJson: source.messageJson,
      errorText: source.errorText ?? null,
      updatedAt: source.updatedAt,
    })
    .where(eq(chatMessagePayloads.id, source.id))
    .run()
}

export function readMessagePayload(
  d: Pick<ChatRuntimeWriteDb, 'select'>,
  payloadId: string,
): StoredMessagePayload | undefined {
  return d
    .select()
    .from(chatMessagePayloads)
    .where(eq(chatMessagePayloads.id, payloadId))
    .get()
}

export function readMessagePayloads(
  d: Pick<ChatRuntimeWriteDb, 'select'>,
  payloadIds: readonly string[],
): Map<string, StoredMessagePayload> {
  const uniquePayloadIds = [...new Set(payloadIds)]
  if (uniquePayloadIds.length === 0) {
    return new Map()
  }
  const rows = d
    .select()
    .from(chatMessagePayloads)
    .where(inArray(chatMessagePayloads.id, uniquePayloadIds))
    .all()
  return new Map(rows.map(row => [row.id, row]))
}

export function toMessageProjectionValues(
  source: MessagePayloadSource & Omit<NewMessage, 'payloadId'>,
): NewMessage {
  return {
    id: source.id,
    sessionId: source.sessionId,
    parentMessageId: source.parentMessageId ?? null,
    parentToolCallId: source.parentToolCallId ?? null,
    taskId: source.taskId ?? null,
    depth: source.depth,
    role: source.role,
    status: source.status,
    payloadId: source.id,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
}

export function hydrateMessage(
  message: Message,
  payload: Pick<StoredMessagePayload, 'content' | 'messageJson' | 'errorText'>,
): HydratedMessage {
  return {
    ...message,
    content: payload.content,
    messageJson: payload.messageJson,
    errorText: payload.errorText,
  }
}

export function messagePayloadJoinCondition() {
  return eq(chatMessagePayloads.id, messages.payloadId)
}

function toPayloadValues(source: MessagePayloadSource) {
  return {
    id: source.id,
    sessionId: source.sessionId,
    content: source.content,
    messageJson: source.messageJson,
    errorText: source.errorText ?? null,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
}
