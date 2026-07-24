import { toastManager } from '~/components/ui/toast'
import { sessionEnvironmentApi } from '~/features/session-environment/api/session-environment'

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

  const handlePin = async () => {
    const result = await sessionEnvironmentApi.pinMessage({
      path: { id: sessionId, messageId },
    })
    if (result.error) {
      toastManager.add({ type: 'error', title: 'Pin failed', description: String(result.error) })
      return
    }
    toastManager.add({ type: 'success', title: 'Message pinned' })
  }

  const handleMarkSelection = async () => {
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const bubble = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    const content = bubble?.querySelector('[data-message-content]')
    if (
      !selection
      || !range
      || !content
      || selection.isCollapsed
      || !content.contains(range.startContainer)
      || !content.contains(range.endContainer)
    ) {
      toastManager.add({ type: 'error', title: 'Select text in this message first' })
      return
    }
    const startRange = document.createRange()
    startRange.selectNodeContents(content)
    startRange.setEnd(range.startContainer, range.startOffset)
    const endRange = document.createRange()
    endRange.selectNodeContents(content)
    endRange.setEnd(range.endContainer, range.endOffset)
    const selectedText = range.toString()
    const result = await sessionEnvironmentApi.createMarker({
      path: { id: sessionId },
      body: {
        messageId,
        startOffset: startRange.toString().length,
        endOffset: endRange.toString().length,
        selectedText,
        style: 'highlight',
        color: 'yellow',
      },
    })
    if (result.error) {
      toastManager.add({ type: 'error', title: 'Marker failed', description: String(result.error) })
      return
    }
    selection.removeAllRanges()
    toastManager.add({ type: 'success', title: 'Selection marked' })
  }

  return (
    <MessageBubbleActionsView
      hasPlainText={hasPlainText}
      isUser={isUser}
      editAction={editAction}
      onCopy={handleCopy}
      onPin={handlePin}
      onMarkSelection={handleMarkSelection}
    />
  )
}
