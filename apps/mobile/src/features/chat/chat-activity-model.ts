import type { UIMessage } from 'ai'
import { isReasoningUIPart, isToolUIPart } from 'ai'

export function chatActivityParts(message?: UIMessage) {
  return message?.parts.filter(part => isReasoningUIPart(part) || isToolUIPart(part)) ?? []
}

export function serializeChatActivity(value: unknown): string | null {
  try {
    return JSON.stringify(value, null, 2) ?? null
  }
  catch {
    return String(value)
  }
}
