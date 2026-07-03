import type { UIMessage } from 'ai'

import { readPositiveIntegerEnv } from '../../helpers/env'
import { readObjectRecord } from '../../helpers/json-record'

const DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS = 256_000
const DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS = 64_000
const DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS = 128_000
const DEFAULT_STORED_MESSAGE_REPAIR_MIN_CHARS = 512 * 1024

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
      preview: json.slice(0, maxChars)
    }
  } catch {
    const text = String(value)
    if (text.length <= maxChars) {
      return text
    }
    return {
      type: 'cradle.truncated-text-payload.v1',
      originalChars: text.length,
      preview: text.slice(0, maxChars)
    }
  }
}

export function truncateSnapshotPayload(value: unknown): unknown {
  return truncateJsonPayload(
    value,
    readPositiveIntegerEnv(
      'CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS',
      DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS
    )
  )
}

export function compactStoredMessageSnapshotForRead<Message extends UIMessage>(input: {
  rawJson: string
  message: Message
}): Message {
  const repairMinChars = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_MESSAGE_REPAIR_MIN_CHARS',
    DEFAULT_STORED_MESSAGE_REPAIR_MIN_CHARS
  )
  if (input.rawJson.length < repairMinChars) {
    return input.message
  }

  const compactedMessage = compactStoredMessageSnapshot(input.message)
  if (compactedMessage === input.message) {
    return input.message
  }

  const compactedJson = JSON.stringify(compactedMessage)
  if (compactedJson.length >= input.rawJson.length) {
    return input.message
  }

  return compactedMessage as Message
}

export function compactStoredMessageSnapshot(message: UIMessage): UIMessage {
  const textLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TEXT_MAX_CHARS',
    DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS
  )
  const reasoningLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_REASONING_MAX_CHARS',
    DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS
  )
  const toolPayloadLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS',
    DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS
  )
  let changed = false
  let remainingText = textLimit
  let remainingReasoning = reasoningLimit

  const parts = message.parts.map((part) => {
    if (part.type === 'text') {
      const nextText =
        part.text.length <= remainingText ? part.text : part.text.slice(0, remainingText)
      remainingText = Math.max(0, remainingText - nextText.length)
      if (nextText !== part.text) {
        changed = true
        return {
          ...part,
          text: nextText,
          providerMetadata: {
            ...readObjectRecord((part as { providerMetadata?: unknown }).providerMetadata),
            cradle: {
              ...readObjectRecord(
                readObjectRecord((part as { providerMetadata?: unknown }).providerMetadata).cradle
              ),
              truncated: true,
              originalChars: part.text.length
            }
          }
        } as UIMessage['parts'][number]
      }
      return part
    }

    if (part.type === 'reasoning') {
      const nextText =
        part.text.length <= remainingReasoning ? part.text : part.text.slice(0, remainingReasoning)
      remainingReasoning = Math.max(0, remainingReasoning - nextText.length)
      if (nextText !== part.text) {
        changed = true
        return {
          ...part,
          text: nextText,
          providerMetadata: {
            ...readObjectRecord((part as { providerMetadata?: unknown }).providerMetadata),
            cradle: {
              ...readObjectRecord(
                readObjectRecord((part as { providerMetadata?: unknown }).providerMetadata).cradle
              ),
              truncated: true,
              originalChars: part.text.length
            }
          }
        } as UIMessage['parts'][number]
      }
      return part
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
