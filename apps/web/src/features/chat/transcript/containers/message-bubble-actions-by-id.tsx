import { useChatRenderStore, useChatRenderStoreApi } from '../../rendering/chat-render-store'
import type { MessageTextTransform } from '../../rendering/message-bubble-selectors'
import {
  readPlainTextFromState,
  readPlainTextPresenceFromState,
} from '../../rendering/message-bubble-selectors'
import type { MessageBubbleEditAction } from '../views/message-bubble-actions-view'
import { MessageBubbleActionsView } from '../views/message-bubble-actions-view'

export interface MessageBubbleActionsByIdProps {
  sessionId: string
  messageId: string
  isUser: boolean
  editAction?: MessageBubbleEditAction
  textTransform?: MessageTextTransform
}

/** Runtime adapter for message persistence, clipboard, and document-selection actions. */
export function MessageBubbleActionsById({
  sessionId,
  messageId,
  isUser,
  editAction,
  textTransform,
}: MessageBubbleActionsByIdProps) {
  const hasPlainText = useChatRenderStore(state =>
    readPlainTextPresenceFromState(state, sessionId, messageId, textTransform))
  const chatStore = useChatRenderStoreApi()

  const handleCopy = async () => {
    const plainText = readPlainTextFromState(
      chatStore.getState(),
      sessionId,
      messageId,
      textTransform,
    )
    await navigator.clipboard.writeText(plainText)
  }

  return (
    <MessageBubbleActionsView
      hasPlainText={hasPlainText}
      isUser={isUser}
      editAction={editAction}
      onCopy={handleCopy}
    />
  )
}
