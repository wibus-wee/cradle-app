import type { ReactNode } from 'react'

import { cn } from '~/lib/cn'

import type { MessageBubbleEditAction, MessageTextTransform } from '../../rendering/message-bubble'
import type { useChatSession } from '../../session/use-chat-session'
import { ChatMinimap } from '../../ui/chat-minimap'
import type { ChatScrollRuntime } from '../../ui/use-chat-scroll-runtime'
import { ChatTranscriptContent } from './chat-transcript-content'

type ChatSessionProjection = ReturnType<typeof useChatSession>

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
