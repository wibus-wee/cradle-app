import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { getChatSessionsBySessionIdAuthRecoveryOptions } from '~/api-gen/@tanstack/react-query.gen'
import type { ChatDisplayRow } from '~/store/chat'

import { AuthRecoveryContainer } from '../../auth-recovery/auth-recovery-container'
import type { MessageTextTransform } from '../../rendering/message-bubble-selectors'
import type { useChatSession } from '../../session/use-chat-session'
import type { ChatScrollRuntime } from '../../ui/use-chat-scroll-runtime'
import { ChatTranscriptView } from '../views/chat-transcript-view'
import type { MessageBubbleEditAction } from '../views/message-bubble-actions-view'
import { MessageBubbleById } from './message-bubble-by-id'
import { MessageSelectionQuoteContainer } from './message-selection-quote-container'

type ChatSessionProjection = ReturnType<typeof useChatSession>

export interface ChatTranscriptContentProps {
  sessionId: string | null
  displayRows: ChatDisplayRow[]
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

/** Runtime adapter that translates display rows into bounded bubble subscriptions. */
export function ChatTranscriptContent({
  sessionId,
  displayRows,
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
  const authRecoveryQuery = useQuery({
    ...getChatSessionsBySessionIdAuthRecoveryOptions({ path: { sessionId: sessionId ?? '' } }),
    enabled: Boolean(sessionId) && status === 'error',
  })
  const authRecovery = authRecoveryQuery.data

  return (
    <>
      <ChatTranscriptView
        messages={displayRows}
        renderMessage={row => (
          <MessageBubbleById
            key={row.rowKey}
            sessionId={sessionId}
            messageId={row.messageId}
            partsProjection={row.partsProjection}
            allowStreaming={row.allowStreaming}
            onToolApprovalResponse={onToolApprovalResponse}
            editAction={row.messageId === editPreviousMessageId ? editPreviousAction : undefined}
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
        authRecovery={sessionId && authRecovery
          ? <AuthRecoveryContainer sessionId={sessionId} recovery={authRecovery} />
          : undefined}
      />
      {sessionId && <MessageSelectionQuoteContainer sessionId={sessionId} rootRef={viewportRef} />}
    </>
  )
}
