import { backendRuns, chatMessagePayloads, messages, sessions } from '@cradle/db'
import type { UIMessage } from 'ai'
import { and, desc, eq, lt, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { reduceChatSessionEventHeaders } from './es/aggregate'
import { readSessionEventHeaders } from './es/event-store'
import { messagePayloadJoinCondition } from './message-payload-store'
import type { ChatMessageStatus } from './run/stream-chunks'
import { assertStoredSession } from './runtime-session-context'
import {
  parseStoredMessageSnapshot as parseTrustedStoredMessageSnapshot,
} from './ui-message'

const messageInsertOrder = sql<number>`messages.rowid`
// Preview stays as a cheap text projection for CLI/list consumers; `message`
// carries the full durable UIMessage snapshot so clients never need per-row
// detail fetches to render a transcript.
const CHAT_HISTORY_PREVIEW_MAX_CHARS = 2_000

export interface ChatMessageRow {
  messageId: string
  role: 'user' | 'assistant'
  status: ChatMessageStatus
  errorText?: string
  preview: string
  previewTruncated: boolean
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
  message: ChatMessageDetail['message']
}

export interface ChatMessageSnapshot {
  revision: number
  rows: ChatMessageRow[]
  nextCursor: string | null
}

export interface ChatMessageDetail {
  message: Omit<UIMessage, 'role'> & { role: 'user' | 'assistant' }
}

export interface ChatMessagePageInput {
  cursor?: string | null
  limit?: number | null
}

export interface CompletedChatRunDto {
  runId: string
  sessionId: string
  sessionTitle: string
  messageId: string | null
  responseBody: string | null
  messagePreview: string | null
  startedAt: number
  finishedAt: number
}

export interface CompletedChatRunsDto {
  runs: CompletedChatRunDto[]
}

export function listCompletedRuns(input: {
  since?: number | null
  limit?: number | null
}): CompletedChatRunsDto {
  const since = Math.max(0, Math.floor(input.since ?? 0))
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 200)
  const rows = db()
    .select({
      runId: backendRuns.id,
      sessionId: backendRuns.chatSessionId,
      sessionTitle: sessions.title,
      messageId: backendRuns.messageId,
      messageContent: chatMessagePayloads.content,
      startedAt: backendRuns.startedAt,
      finishedAt: backendRuns.finishedAt,
    })
    .from(backendRuns)
    .innerJoin(sessions, eq(sessions.id, backendRuns.chatSessionId))
    .leftJoin(messages, eq(messages.id, backendRuns.messageId))
    .leftJoin(chatMessagePayloads, messagePayloadJoinCondition())
    .where(
      and(
        eq(backendRuns.status, 'complete'),
        sql`${backendRuns.finishedAt} IS NOT NULL`,
        sql`${backendRuns.finishedAt} > ${since}`,
      ),
    )
    .orderBy(desc(backendRuns.finishedAt), desc(backendRuns.startedAt))
    .limit(limit)
    .all()

  return {
    runs: rows
      .filter(row => row.finishedAt !== null)
      .map(row => ({
        runId: row.runId,
        sessionId: row.sessionId,
        sessionTitle: row.sessionTitle,
        messageId: row.messageId,
        responseBody: row.messageContent || null,
        messagePreview: row.messageContent ? row.messageContent.slice(0, 200) : null,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt ?? row.startedAt,
      })),
  }
}

export async function getMessageGroups(
  sessionId: string,
  input: ChatMessagePageInput = {},
): Promise<ChatMessageRow[]> {
  return (await getMessagePage(sessionId, input)).rows
}

async function getMessagePage(
  sessionId: string,
  input: ChatMessagePageInput,
): Promise<{
  rows: ChatMessageRow[]
  nextCursor: string | null
  revision: number
}> {
  assertStoredSession(sessionId)
  const headerState = reduceChatSessionEventHeaders(readSessionEventHeaders(sessionId))
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 200)
  const beforeRowId = decodeMessageCursor(input.cursor ?? null)

  const candidates = db()
    .select({
      rowId: messageInsertOrder,
      messageId: messages.id,
      role: messages.role,
      status: messages.status,
      errorText: chatMessagePayloads.errorText,
      preview: sql<string>`substr(${chatMessagePayloads.content}, 1, ${CHAT_HISTORY_PREVIEW_MAX_CHARS + 1})`,
      messageJson: chatMessagePayloads.messageJson,
      parentMessageId: messages.parentMessageId,
      parentToolCallId: messages.parentToolCallId,
      taskId: messages.taskId,
      depth: messages.depth,
    })
    .from(messages)
    .innerJoin(chatMessagePayloads, messagePayloadJoinCondition())
    .where(
      beforeRowId === null
        ? eq(messages.sessionId, sessionId)
        : and(eq(messages.sessionId, sessionId), lt(messageInsertOrder, beforeRowId)),
    )
    .orderBy(desc(messageInsertOrder))
    .limit(limit + 1)
    .all()
  const hasOlderRows = candidates.length > limit
  const page = candidates.slice(0, limit)
  const nextCursor = hasOlderRows && page.length > 0
    ? encodeMessageCursor(page.at(-1)!.rowId)
    : null
  const rows = page.reverse()

  return {
    nextCursor,
    revision: headerState.version,
    rows: rows.map(row => ({
      messageId: row.messageId,
      role: row.role as 'user' | 'assistant',
      status: headerState.messageStatusById.get(row.messageId) ?? row.status as ChatMessageStatus,
      errorText: row.errorText ?? undefined,
      preview: row.preview.slice(0, CHAT_HISTORY_PREVIEW_MAX_CHARS),
      previewTruncated: row.preview.length > CHAT_HISTORY_PREVIEW_MAX_CHARS,
      parentMessageId: row.parentMessageId,
      parentToolCallId: row.parentToolCallId,
      taskId: row.taskId,
      depth: row.depth,
      message: parseStoredMessageSnapshot(
        { id: row.messageId, messageJson: row.messageJson },
        row.role as 'user' | 'assistant',
      ),
    })),
  }
}

export async function getMessageSnapshot(
  sessionId: string,
  input: ChatMessagePageInput = {},
): Promise<ChatMessageSnapshot> {
  const page = await getMessagePage(sessionId, input)
  return {
    revision: page.revision,
    rows: page.rows,
    nextCursor: page.nextCursor,
  }
}

export function toChatMessageRow(input: {
  message: ChatMessageDetail['message']
  status: ChatMessageStatus
  errorText?: string | null
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
  content: string
}): ChatMessageRow {
  return {
    messageId: input.message.id,
    role: input.message.role,
    status: input.status,
    errorText: input.errorText ?? undefined,
    preview: input.content.slice(0, CHAT_HISTORY_PREVIEW_MAX_CHARS),
    previewTruncated: input.content.length > CHAT_HISTORY_PREVIEW_MAX_CHARS,
    parentMessageId: input.parentMessageId,
    parentToolCallId: input.parentToolCallId,
    taskId: input.taskId,
    depth: input.depth,
    message: input.message,
  }
}

export function getMessageDetail(sessionId: string, messageId: string): ChatMessageDetail {
  assertStoredSession(sessionId)
  const row = db()
    .select({ message: messages, payload: chatMessagePayloads })
    .from(messages)
    .innerJoin(chatMessagePayloads, messagePayloadJoinCondition())
    .where(and(eq(messages.id, messageId), eq(messages.sessionId, sessionId)))
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_message_not_found',
      status: 404,
      message: 'Chat message was not found',
      details: { sessionId, messageId },
    })
  }

  const role = row.message.role as 'user' | 'assistant'
  const message = parseStoredMessageSnapshot(
    { id: row.message.id, messageJson: row.payload.messageJson },
    role,
  )
  return { message }
}

function encodeMessageCursor(beforeRowId: number): string {
  return Buffer.from(JSON.stringify({ version: 1, beforeRowId })).toString('base64url')
}

function decodeMessageCursor(cursor: string | null): number | null {
  if (!cursor) {
    return null
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      version: number
      beforeRowId: number
    }
    if (
      decoded.version !== 1
      || !Number.isSafeInteger(decoded.beforeRowId)
      || decoded.beforeRowId < 1
    ) {
      throw new Error('Unsupported cursor payload')
    }
    return decoded.beforeRowId
  }
  catch {
    throw new AppError({
      code: 'chat_message_cursor_invalid',
      status: 400,
      message: 'Chat message cursor is invalid',
    })
  }
}

function parseStoredMessageSnapshot(
  row: { id: string, messageJson: string },
  role: 'user' | 'assistant',
): ChatMessageDetail['message'] {
  try {
    const message = parseTrustedStoredMessageSnapshot(row.messageJson) as ChatMessageDetail['message']
    if (message.id !== row.id) {
      throw new TypeError('message_json.id must match messages.id')
    }
    if (message.role !== role) {
      throw new TypeError('message_json.role must match messages.role')
    }
    if (!Array.isArray(message.parts)) {
      throw new TypeError('message_json.parts must be an array')
    }
    return message
  }
 catch (error) {
    throw new AppError({
      code: 'chat_message_snapshot_invalid',
      status: 500,
      message: 'Stored chat message snapshot is invalid',
      details: {
        messageId: row.id,
        role,
        reason:
          error instanceof Error
            ? `Invalid UIMessage snapshot: ${error.message}`
            : 'Invalid UIMessage snapshot',
      },
    })
  }
}
