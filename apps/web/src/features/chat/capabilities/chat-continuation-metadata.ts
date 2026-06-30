import type { UIMessage } from 'ai'

import type { ChatContinuationMode } from '../commands/chat-response-command'

export interface ChatContinuationMetadata {
  mode: ChatContinuationMode
  queueItemId?: string
  sourceMessageId?: string
  splitParts?: UIMessage['parts']
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function readChatContinuationMetadata(message: UIMessage): ChatContinuationMetadata | null {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradle = readRecord(metadata?.cradle)
  const continuation = readRecord(cradle?.continuation)
  if (!continuation) {
    return null
  }
  const mode = continuation?.mode

  if (mode !== 'queue' && mode !== 'steer') {
    return null
  }

  const queueItemId = continuation.queueItemId
  const sourceMessageId = continuation.sourceMessageId
  const splitParts = readMessageParts(continuation.splitParts)
  return {
    mode,
    ...(typeof queueItemId === 'string' && queueItemId.length > 0 ? { queueItemId } : {}),
    ...(typeof sourceMessageId === 'string' && sourceMessageId.length > 0 ? { sourceMessageId } : {}),
    ...(splitParts ? { splitParts } : {}),
  }
}

function readMessageParts(value: unknown): UIMessage['parts'] | null {
  if (
    !Array.isArray(value)
    || !value.every(part => typeof part === 'object' && part !== null && !Array.isArray(part) && typeof (part as { type?: unknown }).type === 'string')
  ) {
    return null
  }

  return value as UIMessage['parts']
}
