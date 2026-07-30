import type { ChatMessagePartBoundary } from '@cradle/chat-runtime-contracts'
import {
  compactChatMessageSplitParts,
} from '@cradle/chat-runtime-contracts'
import type { UIMessage } from 'ai'

import type { ChatContinuationMode } from '../commands/chat-response-command'

export interface ChatContinuationMetadata {
  mode: ChatContinuationMode
  queueItemId?: string
  sourceMessageId?: string
  splitParts?: ChatMessagePartBoundary[]
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

function readMessageParts(value: unknown): ChatMessagePartBoundary[] | null {
  if (
    !Array.isArray(value)
    || !value.every(part => typeof part === 'object' && part !== null && !Array.isArray(part) && typeof (part as { type?: unknown }).type === 'string')
  ) {
    return null
  }

  return compactChatMessageSplitParts(value as UIMessage['parts'])
}
