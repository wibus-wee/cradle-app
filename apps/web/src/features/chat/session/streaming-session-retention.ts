import type { ChatState } from '~/store/chat'
import { chatSelectors } from '~/store/chat'

export function readRetainableStreamingSessionIds(state: ChatState): string[] {
  return Array.from(state.messagesMap.keys())
    .filter(sessionId => chatSelectors.isSessionStreaming(sessionId)(state))
    .sort()
}
