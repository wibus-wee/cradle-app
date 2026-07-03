import type { FileUIPart, UIMessage } from 'ai'

import { readObjectRecord } from '../../helpers/json-record'
import type { ChatContextPart } from './context-parts'
import { isChatContextPart, readChatContextPart, toOrderedUserMessageParts } from './context-parts'

export function parseStoredMessageSnapshot(raw: string): UIMessage {
  return normalizeMessageSnapshot(JSON.parse(raw) as UIMessage)
}

export function normalizeMessageSnapshot(message: UIMessage): UIMessage {
  if (message.role !== 'user' || !message.parts.some(part => isChatContextPart(part) && typeof readChatContextPart(part)?.position === 'number')) {
    return message
  }

  const text = message.parts
    .flatMap(part => part.type === 'text' ? [part.text] : [])
    .join('')
  const contextParts = message.parts.flatMap((part) => {
    const contextPart = readChatContextPart(part)
    return contextPart ? [contextPart] : []
  })
  const orderedParts = toOrderedUserMessageParts(text, contextParts) as UIMessage['parts']
  orderedParts.push(...message.parts.filter(part => part.type !== 'text' && !isChatContextPart(part)))

  return {
    ...message,
    parts: orderedParts,
  }
}

export function createAssistantMessage(messageId: string, parts: UIMessage['parts'] = []): UIMessage {
  return {
    id: messageId,
    role: 'assistant',
    parts,
  }
}

export function createUserMessage(messageId: string, text: string, files: FileUIPart[] = [], contextParts: ChatContextPart[] = []): UIMessage {
  const parts = toOrderedUserMessageParts(text, contextParts) as UIMessage['parts']
  parts.push(...files)

  return {
    id: messageId,
    role: 'user',
    parts,
  }
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

export function annotateBangResultMessage(message: UIMessage, result: BangCommandResultMetadata): UIMessage {
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
  return parsedMessage.parts
    .flatMap(part => part.type === 'text' ? [part.text] : [])
    .join('')
}
