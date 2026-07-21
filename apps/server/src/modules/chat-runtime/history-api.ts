import { backendRuns, chatMessagePayloads, messages, sessions } from '@cradle/db'
import type { UIMessage } from 'ai'
import { and, desc, eq, lt, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { readCurrentSessionEventVersion } from './es/event-store'
import type { HydratedMessage } from './message-payload-store'
import {
  hydrateMessage,
  messagePayloadJoinCondition,
} from './message-payload-store'
import { compactStoredMessageSnapshotForRead } from './message-snapshot-compaction'
import type { ChatMessageStatus } from './run/stream-chunks'
import { assertStoredSession } from './runtime-session-context'
import { readRunStreamCheckpointsByMessageIds } from './stream/checkpoint-store'
import {
  extractMessageText,
  parseStoredMessageSnapshot as parseTrustedStoredMessageSnapshot,
} from './ui-message'

const messageInsertOrder = sql<number>`messages.rowid`

export interface ChatMessageSnapshotRow {
  messageId: string
  role: 'user' | 'assistant'
  status: ChatMessageStatus
  errorText?: string
  content: string
  message: Omit<UIMessage, 'role'> & { role: 'user' | 'assistant' }
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
}

export interface ChatMessageSnapshot {
  revision: number
  rows: ChatMessageSnapshotRow[]
  nextCursor: string | null
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
): Promise<ChatMessageSnapshotRow[]> {
  return (await getMessagePage(sessionId, input)).rows
}

async function getMessagePage(
  sessionId: string,
  input: ChatMessagePageInput,
): Promise<{ rows: ChatMessageSnapshotRow[], nextCursor: string | null }> {
  assertStoredSession(sessionId)
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 200)
  const beforeRowId = decodeMessageCursor(input.cursor ?? null)

  const candidates = db()
    .select({ rowId: messageInsertOrder, message: messages, payload: chatMessagePayloads })
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

  // Overlay ephemeral streaming checkpoints onto projection rows. Checkpoints are
  // not projected into `messages` during streaming; this preserves ~10s partial
  // text freshness for passive window refresh without polluting the fact log.
  const checkpointByMessageId = new Map(
    readRunStreamCheckpointsByMessageIds(rows.map(row => row.message.id)).map(checkpoint => [
      checkpoint.messageId,
      checkpoint,
    ]),
  )

  return {
    nextCursor,
    rows: rows.map(({ message: projected, payload }) => {
      const row = hydrateMessage(projected, payload)
      const role = row.role as 'user' | 'assistant'
      const checkpoint
        = row.status === 'streaming' ? checkpointByMessageId.get(row.id) : undefined
      const messageJson = checkpoint?.messageJson ?? row.messageJson
      const parsedMessage = parseStoredMessageSnapshot(
        { ...row, messageJson },
        role,
      )
      const message = compactStoredMessageSnapshotForRead({
        rawJson: messageJson,
        message: parsedMessage,
      })
      if (message.id !== row.id || message.role !== role) {
        throw new AppError({
          code: 'chat_message_snapshot_invalid',
          status: 500,
          message: 'Stored chat message snapshot is invalid',
          details: {
            messageId: row.id,
            role,
            reason:
              message.id !== row.id
                ? 'message_json.id must match messages.id'
                : 'message_json.role must match messages.role',
          },
        })
      }

      return {
        messageId: row.id,
        role,
        status: row.status as ChatMessageStatus,
        errorText: row.errorText ?? undefined,
        content: extractMessageText(message),
        message,
        parentMessageId: row.parentMessageId,
        parentToolCallId: row.parentToolCallId,
        taskId: row.taskId,
        depth: row.depth,
      }
    }),
  }
}

export async function getMessageSnapshot(
  sessionId: string,
  input: ChatMessagePageInput = {},
): Promise<ChatMessageSnapshot> {
  const page = await getMessagePage(sessionId, input)
  return {
    revision: readCurrentSessionEventVersion(db(), sessionId),
    rows: page.rows,
    nextCursor: page.nextCursor,
  }
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
  row: HydratedMessage,
  role: 'user' | 'assistant',
): ChatMessageSnapshotRow['message'] {
  try {
    return parseTrustedStoredMessageSnapshot(row.messageJson) as ChatMessageSnapshotRow['message']
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
