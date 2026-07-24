import type { ReactNode } from 'react'

import { cn } from '~/lib/cn'

import {
  GoalMessageLabel,
  SteerMessageLabel,
} from '../../rendering/message-bubble-chrome'
import type { MessageFrame } from '../../rendering/message-bubble-selectors'

const STEER_MESSAGE_CONTAINER_CLASS = 'max-w-[78%]'
const STEER_MESSAGE_BUBBLE_CLASS
  = 'rounded-br-sm bg-background px-3 py-2 text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)/0.45)]'

export interface MessageBubbleFrameViewProps {
  frame: MessageFrame
  isStreaming: boolean
  content: ReactNode
  thinkingPlaceholder?: ReactNode
  debugCaption?: ReactNode
  actions?: ReactNode
}

/** Props-only message chrome shared by fixture and runtime message renderers. */
export function MessageBubbleFrameView({
  frame,
  isStreaming,
  content,
  thinkingPlaceholder,
  debugCaption,
  actions,
}: MessageBubbleFrameViewProps) {
  const isUser = frame.role === 'user'
  const isAssistant = frame.role === 'assistant'

  return (
    <div
      data-testid={`message-bubble-${frame.role}`}
      data-message-id={frame.id}
      data-message-role={frame.role}
      data-message-streaming={isStreaming ? 'true' : 'false'}
      className={cn('group flex w-full gap-3', isUser && 'justify-end')}
    >
      <div
        className={cn(
          'min-w-0',
          isUser
          && !frame.isSteerMessage
          && !frame.bangCommand
          && !frame.bangResult
          && 'max-w-[70%]',
          (frame.bangCommand || frame.bangResult) && 'max-w-[78%]',
          frame.isSteerMessage && STEER_MESSAGE_CONTAINER_CLASS,
          !isUser && 'w-full',
        )}
      >
        {frame.isSteerMessage && <SteerMessageLabel />}
        {frame.isGoalMessage && <GoalMessageLabel />}
        <div
          data-message-content
          className={cn(
            'rounded-lg text-sm leading-relaxed',
            isUser
            && !frame.isSteerMessage
            && !frame.bangCommand
            && !frame.bangResult
            && 'bg-muted text-foreground rounded-br-sm px-3 py-2',
            (frame.bangCommand || frame.bangResult) && 'rounded-br-sm',
            frame.isSteerMessage && STEER_MESSAGE_BUBBLE_CLASS,
            isAssistant && 'text-foreground',
          )}
        >
          {content}
          {thinkingPlaceholder}
        </div>

        {isAssistant && debugCaption}
        {actions}
      </div>
    </div>
  )
}
