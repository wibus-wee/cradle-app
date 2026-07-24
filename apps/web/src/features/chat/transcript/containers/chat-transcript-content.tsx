import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { MessageBubbleEditAction, MessageTextTransform } from '../../rendering/message-bubble'
import { MessageBubbleById } from '../../rendering/message-bubble'
import type { useChatSession } from '../../session/use-chat-session'
import type { ChatScrollRuntime } from '../../ui/use-chat-scroll-runtime'
import { ChatTranscriptView } from '../views/chat-transcript-view'

type ChatSessionProjection = ReturnType<typeof useChatSession>

export interface ChatTranscriptContentProps {
  sessionId: string | null
  messageIds: ChatSessionProjection['messageIds']
  messageCount: ChatSessionProjection['messageCount']
  status: ChatSessionProjection['status']
  error: ChatSessionProjection['error']
  isReady: boolean
  viewportRef: ChatScrollRuntime['viewportRef']
  virtualizerRef: ChatScrollRuntime['virtualizerRef']
  keepMountedIndices: ChatScrollRuntime['keepMountedIndices']
  onVirtualScroll: ChatScrollRuntime['handleVirtualScroll']
  onToolApprovalResponse: ChatSessionProjection['respondToToolApproval']
  editPreviousMessageId?: string | null
  editPreviousAction?: MessageBubbleEditAction
  messageTextTransform?: MessageTextTransform
  compactInset?: boolean
  historyControl?: ReactNode
}

/** Runtime adapter that translates session message IDs into bounded bubble subscriptions. */
export function ChatTranscriptContent({
  sessionId,
  messageIds,
  messageCount,
  status,
  error,
  isReady,
  viewportRef,
  virtualizerRef,
  keepMountedIndices,
  onVirtualScroll,
  onToolApprovalResponse,
  editPreviousMessageId,
  editPreviousAction,
  messageTextTransform,
  compactInset,
  historyControl,
}: ChatTranscriptContentProps) {
  const { t } = useTranslation('chat')

  return (
    <ChatTranscriptView
      messages={messageIds}
      renderMessage={messageId => (
        <MessageBubbleById
          key={messageId}
          sessionId={sessionId}
          messageId={messageId}
          onToolApprovalResponse={onToolApprovalResponse}
          editAction={messageId === editPreviousMessageId ? editPreviousAction : undefined}
          textTransform={messageTextTransform}
        />
      )}
      status={status}
      error={error}
      isReady={isReady || messageCount > 0}
      emptyLabel={t('empty.startConversation')}
      errorFallbackLabel={t('error.loadMessages')}
      viewportRef={viewportRef}
      virtualizerRef={virtualizerRef}
      keepMountedIndices={keepMountedIndices}
      onVirtualScroll={onVirtualScroll}
      compactInset={compactInset}
      historyControl={historyControl}
    />
  )
}
