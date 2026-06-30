import type { UIMessage } from 'ai'

type MessagePart = UIMessage['parts'][number]
type RuntimeMessageInput = UIMessage | string

function isTextPart(part: MessagePart): part is Extract<MessagePart, { type: 'text' }> {
  return part.type === 'text'
}

function describeUnsupportedPart(part: MessagePart): string {
  if (part.type === 'file') {
    const filename = 'filename' in part && part.filename ? ` (${part.filename})` : ''
    return `file${filename}`
  }
  return part.type
}

export function extractUiMessageText(message: RuntimeMessageInput): string {
  if (typeof message === 'string') {
    return message
  }

  return message.parts
    .filter(isTextPart)
    .map(part => part.text)
    .join('\n')
}

export function projectTextOnlyInput(message: RuntimeMessageInput, runtimeLabel: string): string {
  if (typeof message === 'string') {
    const text = message.trim()
    if (!text) {
      throw new Error(`${runtimeLabel} requires non-empty text input`)
    }
    return text
  }

  const unsupportedParts = message.parts.filter(part => !isTextPart(part))
  if (unsupportedParts.length > 0) {
    const details = unsupportedParts.map(describeUnsupportedPart).join(', ')
    throw new Error(`${runtimeLabel} only supports text input; unsupported parts: ${details}`)
  }

  const text = extractUiMessageText(message).trim()
  if (!text) {
    throw new Error(`${runtimeLabel} requires non-empty text input`)
  }

  return text
}
