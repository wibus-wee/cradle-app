import type { SendMessageOptions } from './use-chat-session'

export function readSessionThinkingEffort(
  value: string | null | undefined,
): SendMessageOptions['thinkingEffort'] | null {
  switch (value) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    default:
      return null
  }
}
