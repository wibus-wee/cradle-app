import type { UIMessage } from 'ai'

import { readPositiveIntegerEnv } from '../../helpers/env'
import { readObjectRecord } from '../../helpers/json-record'

const DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS = 256_000
const DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS = 64_000
const DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS = 128_000

export function truncateJsonPayload(value: unknown, maxChars: number): unknown {
  if (value === undefined || value === null) {
    return value
  }

  try {
    const json = JSON.stringify(value)
    if (json.length <= maxChars) {
      return value
    }
    return {
      type: 'cradle.truncated-json-payload.v1',
      originalChars: json.length,
      preview: json.slice(0, maxChars),
    }
  }
  catch {
    const text = String(value)
    if (text.length <= maxChars) {
      return text
    }
    return {
      type: 'cradle.truncated-text-payload.v1',
      originalChars: text.length,
      preview: text.slice(0, maxChars),
    }
  }
}

/**
 * Lossy bounding for **transient** surfaces only: stream checkpoints and
 * observability snapshots, where losing detail is acceptable because the artifact
 * is short-lived or purely diagnostic.
 *
 * Nothing on the durable path may call this. Durable messages keep their bytes via
 * `externalizeMessageBlobs`, which moves oversized tool payloads and text/reasoning
 * overflow into the blob store instead of destroying them.
 */
export function truncateSnapshotPayload(value: unknown): unknown {
  return truncateJsonPayload(
    value,
    readPositiveIntegerEnv(
      'CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS',
      DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS,
    ),
  )
}

/**
 * Preserve a valid UIMessage shape while bounding transient checkpoint bytes.
 * Durable messages must use the blob externalization seam instead.
 */
export function compactTransientMessageSnapshot(message: UIMessage): UIMessage {
  const textLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TEXT_MAX_CHARS',
    DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS,
  )
  const reasoningLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_REASONING_MAX_CHARS',
    DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS,
  )
  const toolPayloadLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS',
    DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS,
  )
  let changed = false
  let remainingText = textLimit
  let remainingReasoning = reasoningLimit

  const parts = message.parts.map((part) => {
    if (part.type === 'text' || part.type === 'reasoning') {
      const remaining = part.type === 'text' ? remainingText : remainingReasoning
      const nextText = part.text.length <= remaining ? part.text : part.text.slice(0, remaining)
      if (part.type === 'text') {
        remainingText = Math.max(0, remainingText - nextText.length)
      }
      else {
        remainingReasoning = Math.max(0, remainingReasoning - nextText.length)
      }
      if (nextText === part.text) {
        return part
      }

      changed = true
      const providerMetadata = readObjectRecord(part.providerMetadata)
      return {
        ...part,
        text: nextText,
        providerMetadata: {
          ...providerMetadata,
          cradle: {
            ...readObjectRecord(providerMetadata.cradle),
            truncated: true,
            originalChars: part.text.length,
          },
        },
      } as UIMessage['parts'][number]
    }

    if ('toolCallId' in part && (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))) {
      let nextPart = part as Record<string, unknown>
      if ('input' in nextPart) {
        const inputPayload = truncateJsonPayload(nextPart.input, toolPayloadLimit)
        if (inputPayload !== nextPart.input) {
          changed = true
          nextPart = { ...nextPart, input: inputPayload }
        }
      }
      if ('output' in nextPart) {
        const outputPayload = truncateJsonPayload(nextPart.output, toolPayloadLimit)
        if (outputPayload !== nextPart.output) {
          changed = true
          nextPart = { ...nextPart, output: outputPayload }
        }
      }
      return nextPart as UIMessage['parts'][number]
    }

    return part
  })

  return changed ? { ...message, parts } : message
}
