import { useEffect, useState } from 'react'

import type { ChatRenderSegment } from '../../rendering/chat-render-plan'
import { useChatRenderStore } from '../../rendering/chat-render-store'
import { ThinkingPlaceholder } from '../../rendering/message-bubble-chrome'
import type { MessageTextTransform } from '../../rendering/message-bubble-selectors'
import {
  hasActiveNonTextSegmentProgress,
  readPlainTextLengthFromState,
} from '../../rendering/message-bubble-selectors'

const THINKING_IDLE_DELAY_MS = 900

function useTextStreamIdle(enabled: boolean, textLength: number): boolean {
  const streamKey = enabled ? textLength : null
  const [idleStreamKey, setIdleStreamKey] = useState<number | null>(null)

  useEffect(() => {
    if (streamKey === null) { return }
    const timer = window.setTimeout(setIdleStreamKey, THINKING_IDLE_DELAY_MS, streamKey)
    return () => window.clearTimeout(timer)
  }, [streamKey])

  return streamKey !== null && idleStreamKey === streamKey
}

export interface MessageBubbleThinkingPlaceholderByIdProps {
  sessionId: string
  messageId: string
  isAssistant: boolean
  isStreaming: boolean
  segments: ChatRenderSegment[]
  textTransform?: MessageTextTransform
  suppressPlaceholder?: boolean
}

/** Store adapter for a streaming bubble's transient thinking indicator. */
export function MessageBubbleThinkingPlaceholderById({
  sessionId,
  messageId,
  isAssistant,
  isStreaming,
  segments,
  textTransform,
  suppressPlaceholder,
}: MessageBubbleThinkingPlaceholderByIdProps) {
  const textLength = useChatRenderStore(state => readPlainTextLengthFromState(state, sessionId, messageId, textTransform))
  const hasActiveProgress = useChatRenderStore(state => hasActiveNonTextSegmentProgress(state, sessionId, messageId, segments))
  const streamTextIdle = useTextStreamIdle(isAssistant && isStreaming, textLength)

  if (!isAssistant || !isStreaming || suppressPlaceholder || hasActiveProgress || (segments.length !== 0 && !streamTextIdle)) { return null }
  return <ThinkingPlaceholder />
}
