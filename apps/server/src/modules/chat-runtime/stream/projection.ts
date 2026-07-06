import { messages } from '@cradle/db'
import type { UIMessage } from 'ai'

import { AppError } from '../../../errors/app-error'
import {
  normalizeMessageSnapshot,
  parseStoredMessageSnapshot as parseTrustedStoredMessageSnapshot
} from '../ui-message'

export type StoredChatMessageSnapshot = Omit<UIMessage, 'role'> & { role: 'user' | 'assistant' }

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
