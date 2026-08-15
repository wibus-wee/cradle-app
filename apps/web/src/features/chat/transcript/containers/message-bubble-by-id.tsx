import type { UIMessage } from 'ai'

import { chatSelectors } from '~/store/chat'
import { applyPartsProjection } from '~/store/chat/expand-messages-for-display'

import { useChatRenderStore } from '../../rendering/chat-render-store'
import {
  readMessageFrame,
  readMessageFromState,
  readMessageImageAttachmentsFromMessage,
  readRenderSegments,
} from '../../rendering/message-bubble-selectors'
import type { MessageBubbleByIdProps } from '../lib/message-bubble-types'
import { MessageDisplayPartsContext } from '../lib/message-display-parts-context'
import { MessageBubbleSegmentsContainer } from './message-bubble-segments-container'

function areProjectedMessagesEqual(
  left: UIMessage | undefined,
  right: UIMessage | undefined,
): boolean {
  return left === right
    || (
      left?.id === right?.id
      && left?.role === right?.role
      && left?.parts === right?.parts
      && left?.metadata === right?.metadata
    )
}

/** Bounded store subscription that adapts a message ID into the runtime bubble renderer. */
export function MessageBubbleById({
  sessionId,
  messageId,
  partsProjection = null,
  allowStreaming = true,
  onToolApprovalResponse,
  editAction,
  textTransform,
}: MessageBubbleByIdProps) {
  const storeSessionId = sessionId ?? ''
  const projectedMessage = useChatRenderStore((state) => {
    const message = readMessageFromState(state, storeSessionId, messageId, textTransform)
    return message ? applyPartsProjection(message, partsProjection) : undefined
  }, areProjectedMessagesEqual)
  const frame = projectedMessage ? readMessageFrame(projectedMessage) : null
  const segments = projectedMessage ? readRenderSegments(projectedMessage) : []
  const storeStreaming = useChatRenderStore(
    chatSelectors.isVisibleStreamingMessage(storeSessionId, messageId),
    (a, b) => a === b,
  )
  const isStreaming = allowStreaming && storeStreaming
  const imageAttachments = readMessageImageAttachmentsFromMessage(projectedMessage, segments)

  if (!frame || !projectedMessage) {
    return null
  }
  return (
    <MessageDisplayPartsContext.Provider value={projectedMessage.parts}>
      <MessageBubbleSegmentsContainer
        sessionId={storeSessionId}
        frame={frame}
        segments={segments}
        isStreaming={isStreaming}
        imageAttachments={imageAttachments}
        onToolApprovalResponse={onToolApprovalResponse}
        editAction={editAction}
        textTransform={textTransform}
      />
    </MessageDisplayPartsContext.Provider>
  )
}
