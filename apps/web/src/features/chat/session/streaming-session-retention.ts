import type { ChatState } from '~/store/chat'
import { chatSelectors } from '~/store/chat'

const RENDERER_ONLY_CHAT_VIEW_PREFIXES = [
  'side:',
  'provider-thread:',
] as const

export function isRendererOnlyChatViewId(sessionId: string): boolean {
  return RENDERER_ONLY_CHAT_VIEW_PREFIXES.some(prefix => sessionId.startsWith(prefix))
}

export function readRetainableStreamingSessionIds(state: ChatState): string[] {
  return Array.from(state.messagesMap.keys())
    .filter(sessionId =>
      !isRendererOnlyChatViewId(sessionId)
      && chatSelectors.isSessionStreaming(sessionId)(state))
    .sort()
}
