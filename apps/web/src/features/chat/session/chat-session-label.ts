export const CHAT_SESSION_FALLBACK_LABEL = 'Chat'

export function isGeneratedChatLabel(label: string, sessionId: string): boolean {
  return label === `Chat: ${sessionId.slice(0, 6)}`
}
