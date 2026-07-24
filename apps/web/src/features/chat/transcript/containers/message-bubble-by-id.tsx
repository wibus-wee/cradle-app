import { useQuery } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { useEffect } from 'react'

import { chatSelectors } from '~/store/chat'

import { chatMessageDetailQueryOptions } from '../../api/messages'
import { useChatRenderStore, useChatRenderStoreApi } from '../../rendering/chat-render-store'
import {
  areMessageFramesEqual,
  areMessageImageAttachmentsEqual,
  areRenderSegmentsEqual,
  readMessageFrameFromState,
  readMessageFromState,
  readMessageImageAttachmentsFromState,
  readRenderSegmentsFromState,
} from '../../rendering/message-bubble-selectors'
import { isChatMessageShell } from '../../session/use-chat-session-types'
import type { MessageBubbleByIdProps } from '../lib/message-bubble-types'
import { MessageBubbleSegmentsContainer } from './message-bubble-segments-container'

/**
 * Bounded store subscription that adapts a message ID into the runtime bubble renderer.
 * History shells hydrate their durable detail payload on mount (retention-bounded transcript).
 */
export function MessageBubbleById({
  sessionId,
  messageId,
  onToolApprovalResponse,
  editAction,
  textTransform,
}: MessageBubbleByIdProps) {
  const storeSessionId = sessionId ?? ''
  const frame = useChatRenderStore(state => readMessageFrameFromState(state, storeSessionId, messageId, textTransform), areMessageFramesEqual)
  const segments = useChatRenderStore(state => readRenderSegmentsFromState(state, storeSessionId, messageId, textTransform), areRenderSegmentsEqual)
  const isStreaming = useChatRenderStore(chatSelectors.isVisibleStreamingMessage(storeSessionId, messageId), (a, b) => a === b)
  const imageAttachments = useChatRenderStore(state => readMessageImageAttachmentsFromState(state, storeSessionId, segments), areMessageImageAttachmentsEqual)
  const isShell = useChatRenderStore((state) => {
    const message = readMessageFromState(state, storeSessionId, messageId)
    return message ? isChatMessageShell(message) : false
  })
  const chatStore = useChatRenderStoreApi()
  const detailQuery = useQuery({
    ...chatMessageDetailQueryOptions(storeSessionId, messageId),
    enabled: Boolean(sessionId) && isShell && !isStreaming,
  })

  useEffect(() => {
    const detail = detailQuery.data?.message
    if (
      !detail
      || !sessionId
      || (detail.role !== 'user' && detail.role !== 'assistant')
    ) {
      return
    }
    chatStore.getState().updateMessage(
      storeSessionId,
      messageId,
      () => detail as UIMessage,
    )
  }, [chatStore, detailQuery.data, messageId, sessionId, storeSessionId])

  if (!frame) { return null }
  return <MessageBubbleSegmentsContainer sessionId={storeSessionId} frame={frame} segments={segments} isStreaming={isStreaming} imageAttachments={imageAttachments} onToolApprovalResponse={onToolApprovalResponse} editAction={editAction} textTransform={textTransform} />
}
