import type { SendMessageOptions } from './use-chat-session'

export function readSessionThinkingEffort(
  value: string | null | undefined,
): SendMessageOptions['thinkingEffort'] | null {
  switch (value) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return value
    default:
      return null
  }
}
