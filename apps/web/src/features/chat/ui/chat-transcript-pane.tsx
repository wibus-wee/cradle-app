import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import type { MessageBubbleEditAction, MessageTextTransform } from '../rendering/message-bubble'
import { MessageBubbleById } from '../rendering/message-bubble'
import type { useChatSession } from '../session/use-chat-session'
import { ChatMinimap } from './chat-minimap'
import { ChatTranscriptView } from './chat-transcript-view'
import type { ChatScrollRuntime } from './use-chat-scroll-runtime'

type ChatSessionProjection = ReturnType<typeof useChatSession>

function ChatTranscriptContent({
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
}: {
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
}) {
  const { t } = useTranslation('chat')
  function renderMessage(messageId: string) {
    return (
      <MessageBubbleById
        key={messageId}
        sessionId={sessionId}
        messageId={messageId}
        onToolApprovalResponse={onToolApprovalResponse}
        editAction={messageId === editPreviousMessageId ? editPreviousAction : undefined}
        textTransform={messageTextTransform}
      />
    )
  }

  return (
    <ChatTranscriptView
      messages={messageIds}
      renderMessage={renderMessage}
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

export function ChatMessageListPane({
  sessionId,
  messageIds,
  messageCount,
  status,
  error,
  isReady,
  scrollContainerRef,
  viewportRef,
  composerOverlayRef,
  virtualizerRef,
  minimapRef,
  keepMountedIndices,
  scrollMetrics,
  onVirtualScroll,
  onScrollToMessageIndex,
  onScrollToOffset,
  onToolApprovalResponse,
  editPreviousMessageId,
  editPreviousAction,
  composerStack,
  hideMinimap,
  messageTextTransform,
  compactInset,
  historyControl,
}: {
  sessionId: string | null
  messageIds: ChatSessionProjection['messageIds']
  messageCount: ChatSessionProjection['messageCount']
  status: ChatSessionProjection['status']
  error: ChatSessionProjection['error']
  isReady: boolean
  scrollContainerRef: ChatScrollRuntime['scrollContainerRef']
  viewportRef: ChatScrollRuntime['viewportRef']
  composerOverlayRef: ChatScrollRuntime['composerOverlayRef']
  virtualizerRef: ChatScrollRuntime['virtualizerRef']
  minimapRef: ChatScrollRuntime['minimapRef']
  keepMountedIndices: ChatScrollRuntime['keepMountedIndices']
  scrollMetrics: ChatScrollRuntime['metrics']
  onVirtualScroll: ChatScrollRuntime['handleVirtualScroll']
  onScrollToMessageIndex: ChatScrollRuntime['scrollToMessageIndex']
  onScrollToOffset: ChatScrollRuntime['scrollToOffset']
  onToolApprovalResponse: ChatSessionProjection['respondToToolApproval']
  editPreviousMessageId?: string | null
  editPreviousAction?: MessageBubbleEditAction
  composerStack: ReactNode
  hideMinimap?: boolean
  messageTextTransform?: MessageTextTransform
  compactInset?: boolean
  historyControl?: ReactNode
}) {
  return (
    <div ref={scrollContainerRef} className="relative min-h-0 flex-1 overflow-hidden">
      <ChatTranscriptContent
        sessionId={sessionId}
        messageIds={messageIds}
        messageCount={messageCount}
        status={status}
        error={error}
        isReady={isReady}
        viewportRef={viewportRef}
        virtualizerRef={virtualizerRef}
        keepMountedIndices={keepMountedIndices}
        onVirtualScroll={onVirtualScroll}
        onToolApprovalResponse={onToolApprovalResponse}
        editPreviousMessageId={editPreviousMessageId}
        editPreviousAction={editPreviousAction}
        messageTextTransform={messageTextTransform}
        compactInset={compactInset}
        historyControl={historyControl}
      />

      <div ref={composerOverlayRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div
          className={cn(
            'mx-auto pt-4 pb-3',
            compactInset ? 'px-4' : 'max-w-[90%] px-4 pr-12',
          )}
        >
          {composerStack}
        </div>
      </div>

      {hideMinimap
        ? null
        : (
            <ChatMinimap
              ref={minimapRef}
              sessionId={sessionId}
              messageIds={messageIds}
              scrollHeight={scrollMetrics.scrollHeight}
              viewportHeight={scrollMetrics.viewportHeight}
              onScrollToIndex={onScrollToMessageIndex}
              onScrollTo={onScrollToOffset}
            />
          )}
    </div>
  )
}
