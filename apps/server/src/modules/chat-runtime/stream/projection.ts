import { messages, sessions } from '@cradle/db'
import type { UIMessage } from 'ai'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import { compactStoredMessageSnapshot } from '../message-snapshot-compaction'
import type { ChatMessageStatus } from '../run/stream-chunks'
import {
  extractMessageText,
  normalizeMessageSnapshot,
  parseStoredMessageSnapshot as parseTrustedStoredMessageSnapshot
} from '../ui-message'

export type StoredChatMessageSnapshot = Omit<UIMessage, 'role'> & { role: 'user' | 'assistant' }

export interface PersistMessageSnapshotInput {
  sessionId: string
  messageId: string
  message: UIMessage
  messageStatus: ChatMessageStatus
  errorText: string | null
}

export interface PersistMessageSnapshotResult {
  messageJsonBytes: number
}

export function persistMessageSnapshot(
  input: PersistMessageSnapshotInput
): PersistMessageSnapshotResult {
  const now = currentUnixSeconds()
  const message = compactStoredMessageSnapshot(normalizeMessageSnapshot(input.message))
  const messageJson = JSON.stringify(message)
  db().transaction((tx) => {
    tx.update(messages)
      .set({
        content: extractMessageText(message),
        messageJson,
        status: input.messageStatus,
        errorText: input.errorText,
        updatedAt: now
      })
      .where(and(eq(messages.id, input.messageId), eq(messages.sessionId, input.sessionId)))
      .run()

    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId)).run()
  })
  return { messageJsonBytes: Buffer.byteLength(messageJson) }
}

export function parseStoredMessageSnapshot(
  row: typeof messages.$inferSelect,
  role: 'user' | 'assistant'
): StoredChatMessageSnapshot {
  try {
    return parseTrustedStoredMessageSnapshot(row.messageJson) as StoredChatMessageSnapshot
  } catch (error) {
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
            : 'Invalid UIMessage snapshot'
      }
    })
  }
}
