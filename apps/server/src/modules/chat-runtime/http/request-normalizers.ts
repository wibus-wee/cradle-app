import type { ChatThinkingEffort } from '../runtime-provider-types'

type QueueThinkingEffort = Extract<ChatThinkingEffort, 'low' | 'medium' | 'high' | 'xhigh'>

export function readChatThinkingEffort(value: unknown): QueueThinkingEffort | undefined {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
    ? value
    : undefined
}

export function readOptionalModelId(value: string | null | undefined): string | null | undefined {
  if (value === null) {
    return null
  }
  return value?.trim() || undefined
}
