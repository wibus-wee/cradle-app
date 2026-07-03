import { AlertLine as AlertCircleIcon } from '@mingcute/react'
import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtualizer } from 'virtua'

import { cn } from '~/lib/cn'

import type { MessageBubbleEditAction, MessageTextTransform } from '../rendering/message-bubble'
import { MessageBubbleById } from '../rendering/message-bubble'
import type { useChatSession } from '../session/use-chat-session'
import { ChatMinimap } from './chat-minimap'
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
    <div
      ref={viewportRef}
      className="h-full overflow-x-hidden overflow-y-auto outline-none [scrollbar-gutter:stable]"
    >
      <div
        className={cn(
          'mx-auto flex min-h-full flex-col pt-4',
          compactInset ? 'px-4' : 'max-w-[90%] px-4 pr-12',
        )}
        style={{ paddingBottom: 'var(--chat-composer-inset, 0px)' }}
      >
        <div className="flex-1">
          {messageCount === 0 && isReady && (
            <div className="flex h-full items-center justify-center py-32">
              <p className="select-none text-sm text-muted-foreground">
                {t('empty.startConversation')}
              </p>
            </div>
          )}

          <Virtualizer
            ref={virtualizerRef}
            data={messageIds}
            scrollRef={viewportRef}
            startMargin={24}
            keepMounted={keepMountedIndices}
            onScroll={onVirtualScroll}
          >
            {renderMessage}
          </Virtualizer>

          {status === 'error' && (
            <m.div
              data-testid="chat-error-banner"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
              className="flex items-start gap-2 pl-1 pt-4"
            >
              <AlertCircleIcon
                className="size-3.5 shrink-0 !text-destructive/70"
                aria-hidden="true"
              />
              <span className="min-w-0 break-all text-xs text-destructive/70">
                {error ?? t('error.loadMessages')}
              </span>
            </m.div>
          )}
        </div>
      </div>
    </div>
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
