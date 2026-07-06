import { messages } from '@cradle/db'
import type { UIMessage } from 'ai'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import { db } from '../../infra'
import { parseStoredMessageSnapshot } from './ui-message'

export interface CradleTurnTranscript {
  history: UIMessage[]
  omittedMessageCount: number
  truncated: boolean
  fallbackMessageCount: number
}

export interface ResolveCradleTurnTranscriptInput {
  sessionId: string
  excludedMessageIds: Set<string>
  maxMessages: number
  maxChars: number
}

interface TranscriptMessageRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  messageJson: string
  createdAt: number
}

const messageInsertOrder = sql`messages.rowid`

export function resolveCradleTurnTranscript(input: ResolveCradleTurnTranscriptInput): CradleTurnTranscript {
  const rows = db()
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      messageJson: messages.messageJson,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.sessionId, input.sessionId),
        eq(messages.status, 'complete'),
        isNull(messages.parentToolCallId),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messageInsertOrder))
    .limit(input.maxMessages + input.excludedMessageIds.size)
    .all() as TranscriptMessageRow[]

  return reconstructCradleTurnTranscript({
    rows,
    excludedMessageIds: input.excludedMessageIds,
    maxMessages: input.maxMessages,
    maxChars: input.maxChars,
  })
}

export async function readFullSessionTranscript(sessionId: string): Promise<UIMessage[]> {
  const rows = db()
    .select({
      messageJson: messages.messageJson,
    })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt, messageInsertOrder)
    .all()

  return rows.map(row => parseStoredMessageSnapshot(row.messageJson))
}

export function reconstructCradleTurnTranscript(input: {
  rows: TranscriptMessageRow[]
  excludedMessageIds: Set<string>
  maxMessages: number
  maxChars: number
}): CradleTurnTranscript {
  const selected: UIMessage[] = []
  let remainingChars = input.maxChars
  let truncated = false
  let fallbackMessageCount = 0
  let omittedMessageCount = 0

  for (const row of input.rows) {
    if (input.excludedMessageIds.has(row.id)) {
      continue
    }
    if (selected.length >= input.maxMessages) {
      omittedMessageCount += 1
      continue
    }
    if (row.role !== 'user' && row.role !== 'assistant') {
      omittedMessageCount += 1
      continue
    }

    const hydration = hydrateTranscriptMessage(row)
    fallbackMessageCount += hydration.usedFallback ? 1 : 0
    const budgeted = budgetTranscriptMessage(hydration.message, remainingChars)
    if (!budgeted.message) {
      truncated = true
      omittedMessageCount += 1
      continue
    }

    selected.push(budgeted.message)
    remainingChars = Math.max(0, remainingChars - budgeted.charCost)
    truncated = truncated || budgeted.truncated
  }

  return {
    history: selected.reverse(),
    omittedMessageCount,
    truncated,
    fallbackMessageCount,
  }
}

function hydrateTranscriptMessage(row: TranscriptMessageRow): { message: UIMessage, usedFallback: boolean } {
  try {
    const message = parseStoredMessageSnapshot(row.messageJson)
    return {
      message: {
        ...message,
        id: row.id,
        role: row.role,
      },
      usedFallback: false,
    }
  }
  catch {
    return {
      message: {
        id: row.id,
        role: row.role,
        parts: [
          {
            type: 'text',
            text: row.content,
            providerMetadata: {
              cradle: {
                transcriptFallback: true,
                reason: 'invalid_message_json',
              },
            },
          },
        ],
      } as UIMessage,
      usedFallback: true,
    }
  }
}

function budgetTranscriptMessage(message: UIMessage, maxChars: number): {
  message: UIMessage | null
  charCost: number
  truncated: boolean
} {
  if (maxChars <= 0) {
    return { message: null, charCost: 0, truncated: true }
  }

  const visibleCost = estimateTranscriptCharCost(message)
  if (visibleCost <= maxChars) {
    return { message, charCost: visibleCost, truncated: false }
  }

  const compacted = compactTranscriptMessage(message, maxChars)
  if (!compacted) {
    return { message: null, charCost: 0, truncated: true }
  }

  return {
    message: compacted,
    charCost: Math.min(estimateTranscriptCharCost(compacted), maxChars),
    truncated: true,
  }
}

function estimateTranscriptCharCost(message: UIMessage): number {
  return message.parts.reduce((total, part) => total + estimatePartCharCost(part), 0)
}

function estimatePartCharCost(part: UIMessage['parts'][number]): number {
  const record = isRecord(part) ? part as Record<string, unknown> : null
  if (!record) {
    return 0
  }
  if (typeof record.text === 'string') {
    return record.text.length
  }
  if (typeof record.reasoning === 'string') {
    return record.reasoning.length
  }
  if (typeof record.input === 'string') {
    return record.input.length
  }
  if (record.input !== undefined || record.output !== undefined || record.errorText !== undefined) {
    return safeStringify({
      input: record.input,
      output: record.output,
      errorText: record.errorText,
    }).length
  }
  if (typeof record.url === 'string') {
    return record.url.length
  }
  return safeStringify(record).length
}

function compactTranscriptMessage(message: UIMessage, maxChars: number): UIMessage | null {
  let remaining = maxChars
  let keptPartCount = 0
  const parts = message.parts.map((part) => {
    const estimatedPartChars = JSON.stringify(part).length
    if (estimatedPartChars <= remaining) {
      remaining -= estimatedPartChars
      keptPartCount += 1
      return part
    }

    const compacted = compactTranscriptPart(part, Math.max(0, remaining))
    if (!compacted) {
      return null
    }

    remaining = 0
    keptPartCount += 1
    return compacted
  }).filter((part): part is UIMessage['parts'][number] => Boolean(part))

  if (keptPartCount === 0 || parts.length === 0) {
    return null
  }

  return {
    ...message,
    parts,
    metadata: {
      ...(isRecord((message as { metadata?: unknown }).metadata) ? (message as { metadata?: Record<string, unknown> }).metadata : {}),
      cradle: {
        ...readCradleMetadata((message as { metadata?: unknown }).metadata),
        transcriptTruncated: true,
      },
    },
  } as UIMessage
}

function compactTranscriptPart(part: UIMessage['parts'][number], maxChars: number): UIMessage['parts'][number] | null {
  if (maxChars <= 0) {
    return null
  }

  const record: Record<string, unknown> | null = isRecord(part)
    ? part as Record<string, unknown>
    : null
  if (record && typeof record.text === 'string') {
    const text = record.text.slice(0, Math.max(0, maxChars - 256))
    if (!text) {
      return null
    }
    return {
      ...part,
      text,
      providerMetadata: {
        ...readProviderMetadata(record.providerMetadata),
        cradle: {
          ...readCradleMetadata(record.providerMetadata),
          transcriptTruncated: true,
          originalChars: record.text.length,
        },
      },
    } as UIMessage['parts'][number]
  }

  if (record) {
    const omittedPartType = typeof record.type === 'string' ? record.type : 'unknown'
    return {
      type: 'text',
      text: `[Cradle transcript part omitted: ${omittedPartType}]`,
      providerMetadata: {
        cradle: {
          transcriptTruncated: true,
          omittedPartType,
        },
      },
    } as UIMessage['parts'][number]
  }

  return null
}

function readProviderMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function readCradleMetadata(value: unknown): Record<string, unknown> {
  const metadata = isRecord(value) ? value : {}
  return isRecord(metadata.cradle) ? metadata.cradle : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  }
  catch {
    return ''
  }
}
