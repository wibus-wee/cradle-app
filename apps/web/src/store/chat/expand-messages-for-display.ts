import type { ChatMessagePartBoundary } from '@cradle/chat-runtime-contracts'
import {
  compactChatMessageSplitParts,
} from '@cradle/chat-runtime-contracts'
import type { UIMessage } from 'ai'

import {
  hasVisibleParts,
  projectHeadParts,
  projectTailParts,
  trimTrailingEmptyParts,
} from './helpers'

export type MessagePartsProjection
  = | { type: 'head', throughSplitParts: ChatMessagePartBoundary[] }
    | {
      type: 'mid'
      afterSplitParts: ChatMessagePartBoundary[]
      throughSplitParts: ChatMessagePartBoundary[]
    }
    | { type: 'tail', afterSplitParts: ChatMessagePartBoundary[] }

/** One virtualized transcript row. Splits are view-only; `messageId` stays canonical. */
export interface ChatDisplayRow {
  rowKey: string
  messageId: string
  partsProjection: MessagePartsProjection | null
  allowStreaming: boolean
}

interface SteerSplitEntry {
  message: UIMessage
  splitParts: ChatMessagePartBoundary[]
  order: number
}

/**
 * Derive transcript rows from canonical store messages.
 * Steer continuations insert visual cuts without inventing `:steer-tail` message ids.
 */
export function expandMessagesForDisplay(messages: UIMessage[]): ChatDisplayRow[] {
  const canonical = messages.filter(message => !message.id.includes(':steer-tail'))
  const steersBySource = new Map<string, SteerSplitEntry[]>()
  const emittedSteerIds = new Set<string>()

  for (let order = 0; order < canonical.length; order++) {
    const message = canonical[order]
    if (message.role !== 'user') {
      continue
    }
    const entry = readSteerSplitEntry(message, order)
    if (!entry) {
      continue
    }
    const group = steersBySource.get(entry.sourceMessageId)
    if (group) {
      group.push(entry)
    }
    else {
      steersBySource.set(entry.sourceMessageId, [entry])
    }
  }

  const rows: ChatDisplayRow[] = []

  for (const message of canonical) {
    if (emittedSteerIds.has(message.id)) {
      continue
    }

    if (message.role === 'assistant') {
      const steers = steersBySource.get(message.id)
      if (!steers || steers.length === 0) {
        rows.push(fullMessageRow(message.id))
        continue
      }

      steers.sort((left, right) => left.order - right.order)
      let previousAbsolute: ChatMessagePartBoundary[] | null = null

      for (const steer of steers) {
        const absolute = trimTrailingEmptyParts(steer.splitParts)
        if (!previousAbsolute) {
          const headParts = projectHeadParts(message.parts, absolute)
          if (hasVisibleParts(headParts)) {
            rows.push({
              rowKey: `${message.id}#steer-head-${steer.message.id}`,
              messageId: message.id,
              partsProjection: { type: 'head', throughSplitParts: absolute },
              allowStreaming: false,
            })
          }
        }
 else {
          const midParts = projectTailParts(
            projectHeadParts(message.parts, absolute),
            previousAbsolute,
          )
          if (hasVisibleParts(midParts)) {
            rows.push({
              rowKey: `${message.id}#steer-mid-${steer.message.id}`,
              messageId: message.id,
              partsProjection: {
                type: 'mid',
                afterSplitParts: previousAbsolute,
                throughSplitParts: absolute,
              },
              allowStreaming: false,
            })
          }
        }

        rows.push(fullMessageRow(steer.message.id))
        emittedSteerIds.add(steer.message.id)
        previousAbsolute = absolute
      }

      rows.push({
        rowKey: `${message.id}#steer-tail-${steers.at(-1)!.message.id}`,
        messageId: message.id,
        partsProjection: {
          type: 'tail',
          afterSplitParts: previousAbsolute ?? [],
        },
        allowStreaming: true,
      })
      continue
    }

    rows.push(fullMessageRow(message.id))
  }

  return rows
}

export function applyPartsProjection(
  message: UIMessage,
  projection: MessagePartsProjection | null | undefined,
): UIMessage {
  if (!projection) {
    return message
  }
  if (projection.type === 'head') {
    return {
      ...message,
      parts: projectHeadParts(message.parts, projection.throughSplitParts),
    }
  }
  if (projection.type === 'mid') {
    return {
      ...message,
      parts: projectTailParts(
        projectHeadParts(message.parts, projection.throughSplitParts),
        projection.afterSplitParts,
      ),
    }
  }
  return {
    ...message,
    parts: projectTailParts(message.parts, projection.afterSplitParts),
  }
}

function fullMessageRow(messageId: string): ChatDisplayRow {
  return {
    rowKey: messageId,
    messageId,
    partsProjection: null,
    allowStreaming: true,
  }
}

function readSteerSplitEntry(
  message: UIMessage,
  order: number,
): (SteerSplitEntry & { sourceMessageId: string }) | null {
  const metadata = (message as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }
  const cradle = (metadata as Record<string, unknown>).cradle
  if (!cradle || typeof cradle !== 'object' || Array.isArray(cradle)) {
    return null
  }
  const continuation = (cradle as { continuation?: unknown }).continuation
  if (!continuation || typeof continuation !== 'object' || Array.isArray(continuation)) {
    return null
  }
  const record = continuation as {
    mode?: unknown
    sourceMessageId?: unknown
    splitParts?: unknown
  }
  if (record.mode !== 'steer') {
    return null
  }
  if (typeof record.sourceMessageId !== 'string' || !record.sourceMessageId) {
    return null
  }
  if (!Array.isArray(record.splitParts)) {
    return null
  }
  if (!record.splitParts.every(part => part && typeof part === 'object' && typeof (part as { type?: unknown }).type === 'string')) {
    return null
  }
  return {
    message,
    sourceMessageId: record.sourceMessageId,
    splitParts: compactChatMessageSplitParts(record.splitParts as UIMessage['parts']),
    order,
  }
}
