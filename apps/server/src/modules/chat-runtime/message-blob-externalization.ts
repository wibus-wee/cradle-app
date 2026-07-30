import { randomUUID } from 'node:crypto'

import type { ChatBlobPayloadRef } from '@cradle/chat-runtime-contracts'
import {
  createChatBlobPayloadRef,
  formatBlobUrl,
  isChatBlobPayloadRef,
  isInlineDataUrl,
  parseBlobUrl,
  readCradlePartPayloadRef,
  readLegacyTruncatedPayload,
} from '@cradle/chat-runtime-contracts'
import { blobs, chatMessageBlobRefs } from '@cradle/db'
import type { FileUIPart, UIMessage } from 'ai'
import { and, eq } from 'drizzle-orm'

import { readPositiveIntegerEnv } from '../../helpers/env'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import type { BlobStoreWriteHandle } from '../blob-store/service'
import { putBlob } from '../blob-store/service'

const DEFAULT_INLINE_ATTACHMENT_MAX_BYTES = 4096
const DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS = 128_000
const DEFAULT_STORED_TOOL_PREVIEW_MAX_CHARS = 4096
const DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS = 256_000
const DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS = 64_000

type BlobRefKind = 'file' | 'tool_input' | 'tool_output' | 'text' | 'reasoning'
/**
 * Walk message parts and externalize oversized inline attachment bytes, tool
 * payloads, and text/reasoning overflow into the content-addressed blob store.
 *
 * Text/reasoning use the same shared per-message budgets as the old lossy
 * truncator (256k / 64k by default). Characters that used to be sliced away
 * become a blob; the part keeps only its budgeted inline prefix plus a
 * `providerMetadata.cradle.payloadRef` pointing at the full text.
 *
 * Write order is blob → ref → (caller commits message). messageId has no FK to
 * messages.id (see chat_message_blob_refs schema): a crash mid-write only leaves
 * an extra ref for Phase A to sweep, never a cradle-blob:// URL whose blob has
 * zero refs.
 */
export function externalizeMessageBlobs(input: {
  sessionId: string
  message: UIMessage
  d?: BlobStoreWriteHandle
}): UIMessage {
  return externalizeMessageBlobsWithScope(input)
}

function externalizeMessageBlobsWithScope(
  input: {
    sessionId: string
    message: UIMessage
    d?: BlobStoreWriteHandle
  },
): UIMessage {
  if (input.d) {
    return externalizeMessageBlobsOnWriteHandle(input, input.d)
  }
  return db().transaction(tx => externalizeMessageBlobsOnWriteHandle(input, tx))
}

function externalizeMessageBlobsOnWriteHandle(
  input: {
    sessionId: string
    message: UIMessage
  },
  d: BlobStoreWriteHandle,
): UIMessage {
  const attachmentFloor = readPositiveIntegerEnv(
    'CRADLE_CHAT_INLINE_ATTACHMENT_MAX_BYTES',
    DEFAULT_INLINE_ATTACHMENT_MAX_BYTES,
  )
  const toolPayloadLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS',
    DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS,
  )
  const previewChars = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS',
    DEFAULT_STORED_TOOL_PREVIEW_MAX_CHARS,
  )
  const textLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TEXT_MAX_CHARS',
    DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS,
  )
  const reasoningLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_REASONING_MAX_CHARS',
    DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS,
  )

  let changed = false
  let remainingText = textLimit
  let remainingReasoning = reasoningLimit
  const parts = [...input.message.parts]

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!part) {
      continue
    }

    if (part.type === 'text') {
      const next = externalizeProsePart({
        d,
        sessionId: input.sessionId,
        messageId: input.message.id,
        index,
        part,
        kind: 'text',
        remaining: remainingText,
        previewChars,
      })
      remainingText = next.remaining
      if (next.changed) {
        changed = true
        parts[index] = next.part
      }
      continue
    }

    if (part.type === 'reasoning') {
      const next = externalizeProsePart({
        d,
        sessionId: input.sessionId,
        messageId: input.message.id,
        index,
        part,
        kind: 'reasoning',
        remaining: remainingReasoning,
        previewChars,
      })
      remainingReasoning = next.remaining
      if (next.changed) {
        changed = true
        parts[index] = next.part
      }
      continue
    }

    if (part.type === 'file') {
      const next = externalizeFilePart({
        d,
        sessionId: input.sessionId,
        messageId: input.message.id,
        index,
        part,
        attachmentFloor,
      })
      if (next !== part) {
        changed = true
        parts[index] = next
      }
      continue
    }

    if (!isToolPart(part)) {
      continue
    }

    let nextPart: UIMessage['parts'][number] = part
    let partRecord = part as Record<string, unknown>

    if ('input' in partRecord) {
      const replaced = externalizeToolPayload({
        d,
        sessionId: input.sessionId,
        messageId: input.message.id,
        index,
        field: 'input',
        value: partRecord.input,
        toolPayloadLimit,
        previewChars,
      })
      if (replaced !== undefined) {
        changed = true
        partRecord = { ...partRecord, input: replaced }
        nextPart = partRecord as UIMessage['parts'][number]
      }
    }

    if ('output' in partRecord) {
      const replaced = externalizeToolPayload({
        d,
        sessionId: input.sessionId,
        messageId: input.message.id,
        index,
        field: 'output',
        value: partRecord.output,
        toolPayloadLimit,
        previewChars,
      })
      if (replaced !== undefined) {
        changed = true
        partRecord = { ...partRecord, output: replaced }
        nextPart = partRecord as UIMessage['parts'][number]
      }
    }

    parts[index] = nextPart
  }

  const message = changed ? { ...input.message, parts } : input.message
  reconcileMessageBlobRefs({
    d,
    sessionId: input.sessionId,
    message,
  })
  return message
}

function isToolPart(part: UIMessage['parts'][number]): boolean {
  return 'toolCallId' in part
    && (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
}

/**
 * Read a text/reasoning overflow ref from `providerMetadata.cradle.payloadRef`.
 * That is the only reference position for prose parts — `part.text` must stay a
 * string for UIMessage / renderer consumers.
 */
export function readPartPayloadRef(
  part: UIMessage['parts'][number],
): ChatBlobPayloadRef | null {
  return readCradlePartPayloadRef(
    (part as { providerMetadata?: unknown }).providerMetadata,
  )
}

function externalizeProsePart(input: {
  d: BlobStoreWriteHandle
  sessionId: string
  messageId: string
  index: number
  part: UIMessage['parts'][number] & { type: 'text' | 'reasoning', text: string }
  kind: 'text' | 'reasoning'
  remaining: number
  previewChars: number
}): {
  part: UIMessage['parts'][number] & { type: 'text' | 'reasoning', text: string }
  remaining: number
  changed: boolean
} {
  // Already externalized (or a legacy destroyed row with only a marker): charge
  // the inline prefix against the shared budget and leave the part alone.
  if (readPartPayloadRef(input.part)) {
    return {
      part: input.part,
      remaining: Math.max(0, input.remaining - input.part.text.length),
      changed: false,
    }
  }

  if (input.part.text.length <= input.remaining) {
    return {
      part: input.part,
      remaining: input.remaining - input.part.text.length,
      changed: false,
    }
  }

  const fullText = input.part.text
  // Keep today's message-level budget: only the overflow leaves the row. A
  // zero remaining budget yields an empty prefix, which is only legal because
  // the blob + payloadRef below restore every character.
  const prefix = fullText.slice(0, input.remaining)
  const blob = putBlobAndRef({
    d: input.d,
    sessionId: input.sessionId,
    messageId: input.messageId,
    partPath: `/parts/${input.index}/text`,
    kind: input.kind,
    bytes: Buffer.from(fullText, 'utf8'),
    mediaType: 'text/plain',
  })
  // Short preview only — `part.text` already holds the budgeted prefix;
  // duplicating that prefix inside the ref would double inline size.
  const payloadRef = createChatBlobPayloadRef({
    blobId: blob.id,
    mediaType: 'text/plain',
    originalChars: fullText.length,
    preview: fullText.slice(0, input.previewChars),
  })

  const existingMetadata = input.part.providerMetadata
  const existingCradle = existingMetadata?.cradle

  return {
    part: {
      ...input.part,
      text: prefix,
      providerMetadata: {
        ...existingMetadata,
        cradle: {
          ...existingCradle,
          truncated: true,
          originalChars: fullText.length,
          payloadRef,
        },
      },
    },
    remaining: Math.max(0, input.remaining - prefix.length),
    changed: true,
  }
}

function externalizeFilePart(input: {
  d: BlobStoreWriteHandle
  sessionId: string
  messageId: string
  index: number
  part: FileUIPart
  attachmentFloor: number
}): FileUIPart {
  if (!isInlineDataUrl(input.part.url)) {
    return input.part
  }

  const decoded = decodeDataUrl(input.part.url)
  if (!decoded || decoded.bytes.length < input.attachmentFloor) {
    return input.part
  }

  const mediaType = decoded.mediaType || input.part.mediaType || 'application/octet-stream'
  const blob = putBlobAndRef({
    d: input.d,
    sessionId: input.sessionId,
    messageId: input.messageId,
    partPath: `/parts/${input.index}/url`,
    kind: 'file',
    bytes: decoded.bytes,
    mediaType,
  })

  return {
    ...input.part,
    url: formatBlobUrl(blob.id),
    mediaType,
  }
}

function externalizeToolPayload(input: {
  d: BlobStoreWriteHandle
  sessionId: string
  messageId: string
  index: number
  field: 'input' | 'output'
  value: unknown
  toolPayloadLimit: number
  previewChars: number
}): ChatBlobPayloadRef | undefined {
  if (isChatBlobPayloadRef(input.value) || readLegacyTruncatedPayload(input.value)) {
    return undefined
  }

  let json: string
  try {
    json = JSON.stringify(input.value)
  }
  catch {
    return undefined
  }

  if (json.length <= input.toolPayloadLimit) {
    return undefined
  }

  const blob = putBlobAndRef({
    d: input.d,
    sessionId: input.sessionId,
    messageId: input.messageId,
    partPath: `/parts/${input.index}/${input.field}`,
    kind: input.field === 'input' ? 'tool_input' : 'tool_output',
    bytes: Buffer.from(json, 'utf8'),
    mediaType: 'application/json',
  })

  return createChatBlobPayloadRef({
    blobId: blob.id,
    mediaType: 'application/json',
    originalChars: json.length,
    preview: json.slice(0, input.previewChars),
  })
}

/**
 * Claim the blob row and insert the owning ref on one write handle so a GC pass
 * cannot delete a deduped-but-still-unreferenced row between the two writes.
 */
function putBlobAndRef(input: {
  d: BlobStoreWriteHandle
  sessionId: string
  messageId: string
  partPath: string
  kind: BlobRefKind
  bytes: Buffer
  mediaType: string
}): { id: string } {
  const blob = putBlob({
    bytes: input.bytes,
    mediaType: input.mediaType,
    d: input.d,
  })
  input.d.insert(chatMessageBlobRefs).values({
    id: randomUUID(),
    sessionId: input.sessionId,
    messageId: input.messageId,
    partPath: input.partPath,
    kind: input.kind,
    blobId: blob.id,
    createdAt: currentUnixSeconds(),
  }).onConflictDoUpdate({
    target: [
      chatMessageBlobRefs.messageId,
      chatMessageBlobRefs.partPath,
    ],
    set: {
      sessionId: input.sessionId,
      kind: input.kind,
      blobId: blob.id,
      createdAt: currentUnixSeconds(),
    },
  }).run()
  return blob
}

function reconcileMessageBlobRefs(input: {
  d: BlobStoreWriteHandle
  sessionId: string
  message: UIMessage
}): void {
  const expected = collectMessageBlobRefs(input.message)
  const claimed = new Set<string>()

  for (const ref of expected) {
    const blobExists = input.d
      .select({ id: blobs.id })
      .from(blobs)
      .where(eq(blobs.id, ref.blobId))
      .get()
    if (!blobExists) {
      continue
    }

    input.d.insert(chatMessageBlobRefs).values({
      id: randomUUID(),
      sessionId: input.sessionId,
      messageId: input.message.id,
      partPath: ref.partPath,
      kind: ref.kind,
      blobId: ref.blobId,
      createdAt: currentUnixSeconds(),
    }).onConflictDoUpdate({
      target: [
        chatMessageBlobRefs.messageId,
        chatMessageBlobRefs.partPath,
      ],
      set: {
        sessionId: input.sessionId,
        kind: ref.kind,
        blobId: ref.blobId,
        createdAt: currentUnixSeconds(),
      },
    }).run()
    claimed.add(messageBlobRefKey(ref.partPath, ref.blobId))
  }

  const storedRefs = input.d
    .select({
      id: chatMessageBlobRefs.id,
      partPath: chatMessageBlobRefs.partPath,
      blobId: chatMessageBlobRefs.blobId,
    })
    .from(chatMessageBlobRefs)
    .where(eq(chatMessageBlobRefs.messageId, input.message.id))
    .all()
  for (const stored of storedRefs) {
    if (claimed.has(messageBlobRefKey(stored.partPath, stored.blobId))) {
      continue
    }
    input.d
      .delete(chatMessageBlobRefs)
      .where(and(
        eq(chatMessageBlobRefs.id, stored.id),
        eq(chatMessageBlobRefs.messageId, input.message.id),
      ))
      .run()
  }
}

function collectMessageBlobRefs(message: UIMessage): Array<{
  partPath: string
  kind: BlobRefKind
  blobId: string
}> {
  const refs: Array<{
    partPath: string
    kind: BlobRefKind
    blobId: string
  }> = []

  for (let index = 0; index < message.parts.length; index += 1) {
    const part = message.parts[index]
    if (!part) {
      continue
    }
    if (part.type === 'file') {
      const blobId = parseBlobUrl(part.url)
      if (blobId) {
        refs.push({
          partPath: `/parts/${index}/url`,
          kind: 'file',
          blobId,
        })
      }
    }

    const proseRef = readPartPayloadRef(part)
    if (proseRef && (part.type === 'text' || part.type === 'reasoning')) {
      refs.push({
        partPath: `/parts/${index}/text`,
        kind: part.type,
        blobId: proseRef.blobId,
      })
    }

    if (!isToolPart(part)) {
      continue
    }
    const record = part as Record<string, unknown>
    for (const field of ['input', 'output'] as const) {
      const payloadRef = isChatBlobPayloadRef(record[field]) ? record[field] : null
      if (!payloadRef) {
        continue
      }
      refs.push({
        partPath: `/parts/${index}/${field}`,
        kind: field === 'input' ? 'tool_input' : 'tool_output',
        blobId: payloadRef.blobId,
      })
    }
  }

  return refs
}

function messageBlobRefKey(partPath: string, blobId: string): string {
  return `${partPath}\0${blobId}`
}

function decodeDataUrl(url: string): { mediaType: string, bytes: Buffer } | null {
  const match = /^data:([^;,]+)?((?:;[^,]*)*);base64,([\s\S]*)$/i.exec(url)
  if (!match) {
    return null
  }
  const mediaType = (match[1] ?? '').trim()
  const payload = match[3] ?? ''
  try {
    return {
      mediaType,
      bytes: Buffer.from(payload, 'base64'),
    }
  }
  catch {
    return null
  }
}
