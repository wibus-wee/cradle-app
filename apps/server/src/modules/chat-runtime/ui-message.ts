import type { FileUIPart, UIMessage } from 'ai'

import { readObjectRecord } from '../../helpers/json-record'
import type { ChatContextPart } from './context-parts'
import { isChatContextPart, readChatContextPart, toOrderedUserMessageParts } from './context-parts'

export function parseStoredMessageSnapshot(raw: string): UIMessage {
  return normalizeMessageSnapshot(JSON.parse(raw) as UIMessage)
}

export function normalizeMessageSnapshot(message: UIMessage): UIMessage {
  if (
    message.role !== 'user'
    || !message.parts.some(
      part => isChatContextPart(part) && typeof readChatContextPart(part)?.position === 'number',
    )
  ) {
    return message
  }

  const text = message.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('')
  const contextParts = message.parts.flatMap((part) => {
    const contextPart = readChatContextPart(part)
    return contextPart ? [contextPart] : []
  })
  const orderedParts = toOrderedUserMessageParts(text, contextParts) as UIMessage['parts']
  orderedParts.push(
    ...message.parts.filter(part => part.type !== 'text' && !isChatContextPart(part)),
  )

  return {
    ...message,
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
