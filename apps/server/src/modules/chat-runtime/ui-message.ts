import type { ChatBlobPayloadRef } from '@cradle/chat-runtime-contracts'
import {
  compactChatMessageSplitMetadata,
  isChatBlobPayloadRef,
  parseBlobUrl,
  readCradlePartPayloadRef,
} from '@cradle/chat-runtime-contracts'
import type { FileUIPart, UIMessage } from 'ai'

import { AppError } from '../../errors/app-error'
import { readObjectRecord } from '../../helpers/json-record'
import { readBlobBytes } from '../blob-store/service'
import type { ChatContextPart } from './context-parts'
import { isChatContextPart, readChatContextPart, toOrderedUserMessageParts } from './context-parts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function isToolPart(
  part: UIMessage['parts'][number],
): part is UIMessage['parts'][number] & {
  toolCallId: string
  input?: JsonValue
  output?: JsonValue
} {
  return 'toolCallId' in part
    && (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
}

function unavailableBlobMarker(
  blobId: string,
  kind: 'file' | 'tool' | 'text',
  detail: string,
): string {
  const label = kind === 'file'
    ? 'Attachment'
    : kind === 'tool'
      ? 'Tool payload'
      : 'Message text'
  return `[${label} unavailable: blob ${blobId} was not found in the store. ${detail}]`
}

async function resolveReferencedPayload(ref: ChatBlobPayloadRef): Promise<JsonValue> {
  try {
    const { bytes } = await readBlobBytes(ref.blobId)
    return JSON.parse(bytes.toString('utf8')) as JsonValue
  }
  catch (error) {
    if (error instanceof AppError && error.code === 'blob_not_found') {
      return [
        unavailableBlobMarker(ref.blobId, 'tool', `Original size: ${ref.originalChars} characters.`),
        'Preview:',
        ref.preview,
      ].join('\n')
    }
    throw error
  }
}

async function resolveReferencedProse(ref: ChatBlobPayloadRef): Promise<string> {
  try {
    const { bytes } = await readBlobBytes(ref.blobId)
    return bytes.toString('utf8')
  }
  catch (error) {
    if (error instanceof AppError && error.code === 'blob_not_found') {
      return [
        unavailableBlobMarker(ref.blobId, 'text', `Original size: ${ref.originalChars} characters.`),
        'Preview:',
        ref.preview,
      ].join('\n')
    }
    throw error
  }
}

function clearPartPayloadRef(
  part: UIMessage['parts'][number] & { type: 'text' | 'reasoning', text: string },
  text: string,
): UIMessage['parts'][number] {
  const providerMetadata = readObjectRecord(
    (part as { providerMetadata?: unknown }).providerMetadata,
  )
  const cradle = readObjectRecord(providerMetadata.cradle)
  const nextCradle: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(cradle)) {
    if (key === 'payloadRef' || key === 'truncated' || key === 'originalChars') {
      continue
    }
    nextCradle[key] = value
  }

  const nextMetadata: Record<string, unknown> = { ...providerMetadata }
  if (Object.keys(nextCradle).length > 0) {
    nextMetadata.cradle = nextCradle
  }
  else {
    delete nextMetadata.cradle
  }

  if (Object.keys(nextMetadata).length === 0) {
    const restPart = { ...part } as typeof part & { providerMetadata?: unknown }
    delete restPart.providerMetadata
    return { ...restPart, text } as UIMessage['parts'][number]
  }

  return {
    ...part,
    text,
    providerMetadata: nextMetadata,
  } as UIMessage['parts'][number]
}

async function resolveProsePartPayloadRef(
  part: UIMessage['parts'][number] & { type: 'text' | 'reasoning', text: string },
): Promise<{ part: UIMessage['parts'][number], changed: boolean }> {
  const ref = readCradlePartPayloadRef(
    (part as { providerMetadata?: unknown }).providerMetadata,
  )
  if (!ref) {
    return { part, changed: false }
  }
  const text = await resolveReferencedProse(ref)
  return { part: clearPartPayloadRef(part, text), changed: true }
}

async function resolveFilePart(
  part: FileUIPart & { type: 'file' },
): Promise<{ part: UIMessage['parts'][number], changed: boolean }> {
  const blobId = parseBlobUrl(part.url)
  if (blobId === null) {
    return { part, changed: false }
  }

  try {
    const { bytes, mediaType } = await readBlobBytes(blobId)
    const resolvedMediaType = mediaType || part.mediaType
    return {
      part: {
        ...part,
        mediaType: resolvedMediaType,
        url: `data:${resolvedMediaType};base64,${bytes.toString('base64')}`,
      },
      changed: true,
    }
  }
  catch (error) {
    if (error instanceof AppError && error.code === 'blob_not_found') {
      const label = part.filename?.trim() || 'attached file'
      return {
        part: {
          type: 'text',
          text: unavailableBlobMarker(blobId, 'file', `Filename: ${label}.`),
        },
        changed: true,
      }
    }
    throw error
  }
}

async function resolveToolPartPayloads(
  part: UIMessage['parts'][number] & { toolCallId: string, input?: JsonValue, output?: JsonValue },
): Promise<{ part: UIMessage['parts'][number], changed: boolean }> {
  const nextInput = isChatBlobPayloadRef(part.input)
    ? await resolveReferencedPayload(part.input)
    : part.input
  const nextOutput = isChatBlobPayloadRef(part.output)
    ? await resolveReferencedPayload(part.output)
    : part.output

  if (nextInput === part.input && nextOutput === part.output) {
    return { part, changed: false }
  }

  // AI SDK tool parts are state-discriminated; spreading to replace input/output
  // is still the same part kind, but TypeScript cannot prove the state union.
  return {
    part: {
      ...part,
      input: nextInput,
      output: nextOutput,
    } as UIMessage['parts'][number],
    changed: true,
  }
}

export function parseStoredMessageSnapshot(raw: string): UIMessage {
  return normalizeMessageSnapshot(JSON.parse(raw) as UIMessage)
}

export function normalizeMessageSnapshot(message: UIMessage): UIMessage {
  const compactedMessage = compactChatMessageSplitMetadata(message)
  if (
    compactedMessage.role !== 'user'
    || !compactedMessage.parts.some(
      part => isChatContextPart(part) && typeof readChatContextPart(part)?.position === 'number',
    )
  ) {
    return compactedMessage
  }

  const text = compactedMessage.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('')
  const contextParts = compactedMessage.parts.flatMap((part) => {
    const contextPart = readChatContextPart(part)
    return contextPart ? [contextPart] : []
  })
  const orderedParts = toOrderedUserMessageParts(text, contextParts) as UIMessage['parts']
  orderedParts.push(
    ...compactedMessage.parts.filter(part => part.type !== 'text' && !isChatContextPart(part)),
  )

  return {
    ...compactedMessage,
    parts: orderedParts,
  }
}

export function createAssistantMessage(
  messageId: string,
  parts: UIMessage['parts'] = [],
): UIMessage {
  return {
    id: messageId,
    role: 'assistant',
    parts,
  }
}

export function createUserMessage(
  messageId: string,
  text: string,
  files: FileUIPart[] = [],
  contextParts: ChatContextPart[] = [],
): UIMessage {
  const parts = toOrderedUserMessageParts(text, contextParts) as UIMessage['parts']
  parts.push(...files)

  return {
    id: messageId,
    role: 'user',
    parts,
  }
}

/**
 * Replaces `cradle-blob://` file parts, `ChatBlobPayloadRef` tool payloads, and
 * text/reasoning `providerMetadata.cradle.payloadRef` overflow refs with real
 * bytes (or an explicit unavailable marker) before a provider sees the message.
 * The original message remains unchanged for the transcript and attachment UI.
 *
 * Codex reconstructed-history injection and OpenAI-compatible history replay
 * both send stored tool `output` back to the model, so tool refs must be
 * resolved here despite living only in Cradle's transcript on disk. The same
 * is true for prose: a provider must never receive an unresolved payloadRef.
 */
export async function resolveMessageBlobReferences(message: UIMessage): Promise<UIMessage> {
  let changed = false
  const parts: UIMessage['parts'] = []

  for (const part of message.parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      const resolved = await resolveProsePartPayloadRef(part)
      changed = changed || resolved.changed
      parts.push(resolved.part)
      continue
    }

    if (part.type === 'file') {
      const resolved = await resolveFilePart(part)
      changed = changed || resolved.changed
      parts.push(resolved.part)
      continue
    }

    if (isToolPart(part)) {
      const resolved = await resolveToolPartPayloads(part)
      changed = changed || resolved.changed
      parts.push(resolved.part)
      continue
    }

    parts.push(part)
  }

  return changed ? { ...message, parts } : message
}

export async function resolveMessageBlobReferencesList(
  messages: UIMessage[] | undefined,
): Promise<UIMessage[] | undefined> {
  if (!messages) {
    return undefined
  }
  return Promise.all(messages.map(message => resolveMessageBlobReferences(message)))
}

/**
 * Replaces image file parts explicitly prepared by the local Light OCR flow
 * with text before a provider sees the message. The original message remains
 * unchanged for the transcript and attachment UI.
 */
export function projectLightOcrMessage(message: UIMessage): UIMessage {
  if (message.role !== 'user') {
    return message
  }

  let usedLightOcr = false
  const parts = message.parts.flatMap((part): UIMessage['parts'] => {
    if (part.type !== 'file') {
      return [part]
    }
    const metadata = readObjectRecord(part.providerMetadata)
    const cradle = readObjectRecord(metadata.cradle)
    const lightOcr = readObjectRecord(cradle.lightOcr)
    const text = typeof lightOcr.text === 'string' ? lightOcr.text.trim() : null
    if (text === null) {
      return [part]
    }

    usedLightOcr = true
    const label = part.filename?.trim() || 'attached image'
    const content = text || '[No readable text was found in this image.]'
    return [
      {
        type: 'text',
        text: [
          `Text recognized locally from ${label}:`,
          '<cradle-local-image-ocr>',
          content,
          '</cradle-local-image-ocr>',
        ].join('\n'),
      } as UIMessage['parts'][number],
    ]
  })

  return usedLightOcr ? { ...message, parts } : message
}

export function projectLightOcrMessages(
  messages: UIMessage[] | undefined,
): UIMessage[] | undefined {
  return messages?.map(projectLightOcrMessage)
}

/**
 * Provider-input projection: resolve blob references first, then Light OCR.
 * Ordering is load-bearing — Light OCR inspects image bytes.
 */
export async function projectProviderInputMessage(message: UIMessage): Promise<UIMessage> {
  return projectLightOcrMessage(await resolveMessageBlobReferences(message))
}

export async function projectProviderInputMessages(
  messages: UIMessage[] | undefined,
): Promise<UIMessage[] | undefined> {
  if (!messages) {
    return undefined
  }
  return Promise.all(messages.map(message => projectProviderInputMessage(message)))
}

export function annotateGoalMessage(message: UIMessage, objective: string): UIMessage {
  const metadata = readObjectRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readObjectRecord(metadata.cradle)
  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradleMetadata,
        goal: { objective },
      },
    },
  } as UIMessage
}

export function annotateBangCommandMessage(message: UIMessage, command: string): UIMessage {
  const metadata = readObjectRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readObjectRecord(metadata.cradle)
  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradleMetadata,
        bangCommand: { command },
      },
    },
  } as UIMessage
}

export interface BangCommandResultMetadata {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
}

export interface ChatRunResultMetadata {
  runId: string
  durationMs: number
}

/**
 * Stamps the terminal assistant message with its run identity and wall-clock
 * duration so history restores can render "Worked for Ns" without querying
 * run snapshots.
 */
export function annotateRunResultMessage(
  message: UIMessage,
  run: ChatRunResultMetadata,
): UIMessage {
  const metadata = readObjectRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readObjectRecord(metadata.cradle)
  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradleMetadata,
        run,
      },
    },
  } as UIMessage
}

export function annotateBangResultMessage(
  message: UIMessage,
  result: BangCommandResultMetadata,
): UIMessage {
  const metadata = readObjectRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readObjectRecord(metadata.cradle)
  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradleMetadata,
        bangResult: result,
      },
    },
  } as UIMessage
}

export function readGoalMessageObjective(message: UIMessage): string | null {
  const metadata = readObjectRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readObjectRecord(metadata.cradle)
  const goal = readObjectRecord(cradleMetadata.goal)
  return typeof goal.objective === 'string' && goal.objective.trim().length > 0
    ? goal.objective.trim()
    : null
}

export function extractMessageText(message: UIMessage): string {
  const parsedMessage = normalizeMessageSnapshot(message)
  return parsedMessage.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('')
}
