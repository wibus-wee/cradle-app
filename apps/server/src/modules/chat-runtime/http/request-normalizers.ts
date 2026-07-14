import type { ChatThinkingEffort } from '../runtime-provider-types'

export function readChatThinkingEffort(value: unknown): ChatThinkingEffort | undefined {
  return value === 'none'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
    || value === 'max'
    || value === 'ultra'
    ? value
    : undefined
}

export function readOptionalModelId(value: string | null | undefined): string | null | undefined {
  if (value === null) {
    return null
  }
  return value?.trim() || undefined
}
