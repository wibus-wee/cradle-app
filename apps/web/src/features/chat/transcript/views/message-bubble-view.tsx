import { Streamdown } from '@cradle/streamdown'
import type { UIMessage } from 'ai'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { cn } from '~/lib/cn'

import { readChatContinuationMetadata } from '../../capabilities/chat-continuation-metadata'
import { readBangCommandMetadata, readBangResultMetadata } from '../../commands/bang-command-metadata'
import { BangCommandBlock, BangCommandPromptBlock } from '../../rendering/blocks/bang-command-block'
import { ReasoningBlock } from '../../rendering/blocks/reasoning-block'
import { RuntimeWarningBlock } from '../../rendering/blocks/runtime-warning-block'
import type { ChatRenderItem } from '../../rendering/chat-render-plan'
import { groupMessageParts, splitExecutionPhase } from '../../rendering/chat-render-plan'
import { toolNameFromPart } from '../../rendering/chat-tool-entities'
import {
  ExecutionPhaseFold,
  GoalMessageLabel,
  SteerMessageLabel,
  ThinkingPlaceholder,
} from '../../rendering/message-bubble-chrome'
import {
  hasActiveNonTextProgress,
  isCodexGoalUserMessage,
  readActiveStreamingItemKey,
  readMarkdownAnchorProps,
  readMessageDisplayText,
  readToolApproval,
} from '../../rendering/message-bubble-selectors'
import { MESSAGE_STREAMING_ANIMATION_MAX_CHARS } from '../../rendering/message-rendering-constants'
import { describeToolCall } from '../../rendering/tool-ui-classifier'
import { UserMessageText } from '../../rendering/user-message-text'
import { GroupedToolCallBlockView } from '../../tool-blocks/views/grouped-tool-call-block-view'
import { ToolCallBlockView } from '../../tool-blocks/views/tool-call-block-view'
import { FileAttachmentView } from './file-attachment-view'
import { MarkdownFileLinkView } from './markdown-file-link-view'
import { MessageBubbleActionsView } from './message-bubble-actions-view'
import { PluginContextView } from './plugin-context-view'
import { SkillContextView } from './skill-context-view'

const THINKING_IDLE_DELAY_MS = 900
const STEER_MESSAGE_CONTAINER_CLASS = 'max-w-[78%]'
const STEER_MESSAGE_BUBBLE_CLASS
  = 'rounded-br-sm bg-background px-3 py-2 text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)/0.45)]'

const DEFAULT_STREAMDOWN_OPTIONS = {
  animationPreset: 'balanced',
  animateMode: 'char',
  showCursor: false,
} as const

export interface MessageBubbleViewProps {
  message: UIMessage
  isStreaming: boolean
  executionDetailsDefaultOpen?: boolean
  presentation?: 'thread' | 'export'
  onToolApprovalResponse?: (response: { messageId: string, approvalId: string, approved: boolean }) => void
  onCopy?: (text: string) => void | Promise<void>
  debugCaption?: ReactNode
}

function useTextStreamIdle(enabled: boolean, textLength: number): boolean {
  const streamKey = enabled ? textLength : null
  const [idleStreamKey, setIdleStreamKey] = useState<number | null>(null)

  useEffect(() => {
    if (streamKey === null) {
      return
    }

    const timer = window.setTimeout(setIdleStreamKey, THINKING_IDLE_DELAY_MS, streamKey)
    return () => window.clearTimeout(timer)
  }, [streamKey])

  return streamKey !== null && idleStreamKey === streamKey
}

/** Fixture-driven renderer for a fully materialized UIMessage. */
export function MessageBubbleView({
  message,
  isStreaming,
  executionDetailsDefaultOpen = false,
  presentation = 'thread',
  onToolApprovalResponse,
  onCopy,
  debugCaption,
}: MessageBubbleViewProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isExportPresentation = presentation === 'export'
  const continuationMetadata = readChatContinuationMetadata(message)
  const isSteerMessage = isUser && continuationMetadata?.mode === 'steer'
  const isGoalMessage = isCodexGoalUserMessage(message)
  const bangCommand = isUser ? readBangCommandMetadata(message) : null
  const bangResult = isUser ? readBangResultMetadata(message) : null
  const plainText = readMessageDisplayText(message)
  const streamTextIdle = useTextStreamIdle(isAssistant && isStreaming, plainText.length)
  const groupedItems = groupMessageParts({
    parts: message.parts,
    messageId: message.id,
    describeToolKind: part => describeToolCall(part).kind,
  })
  const activeStreamingItemKey = isStreaming ? readActiveStreamingItemKey(groupedItems) : null
  const executionPhaseSplit = isStreaming
    ? null
    : splitExecutionPhase(groupedItems, { describeToolKind: part => describeToolCall(part).kind })
  const showThinkingPlaceholder = isAssistant && isStreaming && !hasActiveNonTextProgress(groupedItems)
    && (groupedItems.length === 0 || streamTextIdle)

  function renderItem(item: ChatRenderItem) {
    switch (item.kind) {
      case 'text':
        return isUser
          ? <UserMessageText key={item.key} text={item.text} />
          : (
              <Streamdown
                key={item.key}
                content={item.text}
                streaming={item.key === activeStreamingItemKey}
                animationPreset={DEFAULT_STREAMDOWN_OPTIONS.animationPreset}
                animateMode={DEFAULT_STREAMDOWN_OPTIONS.animateMode}
                showCursor={DEFAULT_STREAMDOWN_OPTIONS.showCursor}
                animated={item.text.length <= MESSAGE_STREAMING_ANIMATION_MAX_CHARS}
                components={{ a: props => <MarkdownFileLinkView {...readMarkdownAnchorProps(props)} /> }}
              />
            )
      case 'reasoning':
        return <ReasoningBlock key={item.key} text={item.text} state={item.key === activeStreamingItemKey && item.state === 'streaming' ? 'streaming' : 'done'} />
      case 'tool-group':
        return <GroupedToolCallBlockView key={item.key} items={item.items} uiKind={item.uiKind} />
      case 'tool-call': {
        const approval = readToolApproval(item.part)
        return (
          <ToolCallBlockView
            key={item.key}
            toolName={toolNameFromPart(item.part)}
            toolCallId={item.part.toolCallId}
            state={item.part.state}
            approval={approval}
            argumentsText={item.part.argumentsText}
            input={item.part.input}
            output={item.part.output}
            errorText={item.part.errorText}
            onApprovalResponse={approval && onToolApprovalResponse
              ? response => onToolApprovalResponse({ messageId: message.id, approvalId: response.id, approved: response.approved })
              : undefined}
          />
        )
      }
      case 'file-attachment': return <FileAttachmentView key={item.key} part={item.part} />
      case 'skill-context': return <SkillContextView key={item.key} part={item.part} />
      case 'plugin-context': return <PluginContextView key={item.key} part={item.part} />
      case 'runtime-warning': return <RuntimeWarningBlock key={item.key} warning={item.part.data} />
      default: return null
    }
  }

  const content = bangCommand
    ? <BangCommandPromptBlock command={bangCommand.command} />
    : bangResult
      ? <BangCommandBlock result={bangResult} />
      : !executionPhaseSplit
          ? groupedItems.map(renderItem)
          : isExportPresentation
              ? executionPhaseSplit.finalItems.map(renderItem)
              : (
<>
<ExecutionPhaseFold defaultOpen={executionDetailsDefaultOpen}>{executionPhaseSplit.executionItems.map(renderItem)}</ExecutionPhaseFold>
{executionPhaseSplit.finalItems.map(renderItem)}
</>
)

  return (
    <div
      data-testid={`message-bubble-${message.role}`}
      data-message-id={message.id}
      data-message-role={message.role}
      data-message-streaming={isStreaming ? 'true' : 'false'}
      className={cn('group flex w-full gap-3', isUser && 'justify-end')}
    >
      <div className={cn('min-w-0', isUser && !isSteerMessage && !bangCommand && !bangResult && 'max-w-[70%]', (bangCommand || bangResult) && 'max-w-[78%]', isSteerMessage && STEER_MESSAGE_CONTAINER_CLASS, !isUser && 'w-full')}>
        {isSteerMessage && <SteerMessageLabel />}
        {isGoalMessage && <GoalMessageLabel />}
        <div data-message-content className={cn('rounded-lg text-sm leading-relaxed', isUser && !isSteerMessage && !bangCommand && !bangResult && 'bg-muted text-foreground rounded-br-sm px-3 py-2', (bangCommand || bangResult) && 'rounded-br-sm', isSteerMessage && STEER_MESSAGE_BUBBLE_CLASS, isAssistant && 'text-foreground')}>
          {content}
          {showThinkingPlaceholder && <ThinkingPlaceholder />}
        </div>
        {isAssistant && debugCaption}
        {!isExportPresentation && !isStreaming && plainText.length > 0 && onCopy && <MessageBubbleActionsView hasPlainText isUser={isUser} onCopy={() => onCopy(plainText)} />}
      </div>
    </div>
  )
}
