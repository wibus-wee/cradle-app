import type { UIMessage } from 'ai'

export interface ChatMessagePartBoundary {
  type: string
  toolCallId?: string
  text?: string
  reasoning?: string
}

type BoundarySourcePart = UIMessage['parts'][number] & {
  toolCallId?: string
  reasoning?: string
}

/**
 * Keep only the stream identity needed to cut a message into transcript rows.
 * Attachment URLs and tool payloads can be very large and remain owned by the
 * canonical assistant message.
 */
export function compactChatMessageSplitParts(
  parts: UIMessage['parts'] | ChatMessagePartBoundary[],
): ChatMessagePartBoundary[] {
  return parts.map((part) => {
    const source = part as BoundarySourcePart
    if (source.type === 'text') {
      return { type: source.type, text: source.text }
    }
    if (source.type === 'reasoning') {
      return {
        type: source.type,
        ...(source.text !== undefined ? { text: source.text } : {}),
        ...(source.reasoning !== undefined ? { reasoning: source.reasoning } : {}),
      }
    }
    return {
      type: source.type,
      ...(source.toolCallId ? { toolCallId: source.toolCallId } : {}),
    }
  })
}

/**
 * Compact legacy persisted steer metadata while hydrating a UIMessage. New
 * messages are already written in this shape, but old rows may contain entire
 * file parts (including multi-megabyte base64 data URLs).
 */
export function compactChatMessageSplitMetadata(message: UIMessage): UIMessage {
  const metadata = readRecord(message.metadata)
  const cradle = readRecord(metadata?.cradle)
  const continuation = readRecord(cradle?.continuation)
  const splitParts = continuation?.splitParts
  if (
    continuation?.mode !== 'steer'
    || !Array.isArray(splitParts)
    || !splitParts.every(isMessagePartLike)
  ) {
    return message
  }

  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradle,
        continuation: {
          ...continuation,
          splitParts: compactChatMessageSplitParts(splitParts as UIMessage['parts']),
        },
      },
    },
  } as UIMessage
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isMessagePartLike(value: unknown): boolean {
  const record = readRecord(value)
  return typeof record?.type === 'string'
}
