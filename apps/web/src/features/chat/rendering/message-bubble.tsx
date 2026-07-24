import { Streamdown } from '@cradle/streamdown'
import type { UIMessage } from 'ai'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { cn } from '~/lib/cn'
import { chatSelectors } from '~/store/chat'
import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import { readChatContinuationMetadata } from '../capabilities/chat-continuation-metadata'
import { readBangCommandMetadata, readBangResultMetadata } from '../commands/bang-command-metadata'
import { GroupedToolCallBlockView } from '../tool-blocks/views/grouped-tool-call-block-view'
import { ToolCallBlockView } from '../tool-blocks/views/tool-call-block-view'
import { MessageBubbleActionsById } from '../transcript/containers/message-bubble-actions-by-id'
import { MarkdownFileLinkView } from '../transcript/views/markdown-file-link-view'
import type { MessageBubbleEditAction } from '../transcript/views/message-bubble-actions-view'
import {
  MessageBubbleActionsView,
} from '../transcript/views/message-bubble-actions-view'
import { BangCommandBlock, BangCommandPromptBlock } from './blocks/bang-command-block'
import { ReasoningBlock } from './blocks/reasoning-block'
import { RuntimeWarningBlock } from './blocks/runtime-warning-block'
import type {
  ChatRenderItem,
  ChatRenderSegment,
} from './chat-render-plan'
import {
  groupMessageParts,
  splitExecutionPhase,
  splitSegmentExecutionPhase,
} from './chat-render-plan'
import { useChatRenderStore } from './chat-render-store'
import { toolNameFromPart } from './chat-tool-entities'
import { ImageLightbox } from './image-lightbox'
import {
  FileAttachmentBlock,
  PluginContextBlock,
  SkillContextBlock,
} from './message-attachment-blocks'
import {
  ExecutionPhaseFold,
  GoalMessageLabel,
  SteerMessageLabel,
  ThinkingPlaceholder,
} from './message-bubble-chrome'
import type {
  MessageFrame,
  MessageImageAttachment,
  MessageTextTransform,
} from './message-bubble-selectors'
import {
  areMessageFramesEqual,
  areMessageImageAttachmentsEqual,
  areRenderSegmentsEqual,
  hasActiveNonTextProgress,
  hasActiveNonTextSegmentProgress,
  isCodexGoalUserMessage,
  readActiveStreamingItemKey,
  readActiveStreamingSegmentKey,
  readMarkdownAnchorProps,
  readMessageDisplayText,
  readMessageFrameFromState,
  readMessageImageAttachmentsFromState,
  readPlainTextLengthFromState,
  readRenderSegmentsFromState,
  readToolApproval,
} from './message-bubble-selectors'
import {
  MessageFileLineCommentContextPartById,
  MessageFilePartById,
  MessagePluginContextPartById,
  MessageReasoningPartById,
  MessageRuntimeWarningPartById,
  MessageSkillContextPartById,
  MessageTextPartById,
} from './message-part-blocks'
import { MESSAGE_STREAMING_ANIMATION_MAX_CHARS } from './message-rendering-constants'
import type { MessageToolApprovalHandler } from './message-tool-blocks'
import {
  GroupedToolCallBlockByPartIndexes,
  ToolCallBlockByPartIndex,
} from './message-tool-blocks'
import { RunDebugCaption } from './run-debug-caption'
import { describeToolCall } from './tool-ui-classifier'
import { UserMessageText } from './user-message-text'

export { ChatRenderStoreProvider } from './chat-render-store'

const THINKING_IDLE_DELAY_MS = 900
const STEER_MESSAGE_CONTAINER_CLASS = 'max-w-[78%]'
const STEER_MESSAGE_BUBBLE_CLASS
  = 'rounded-br-sm bg-background px-3 py-2 text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)/0.45)]'
const IMAGE_ATTACHMENT_GRID_ITEM_CLASS = 'min-w-0 max-w-[300px] flex-1 basis-[calc(50%-0.25rem)]'

export type { MessageBubbleEditAction } from '../transcript/views/message-bubble-actions-view'
export type { MessageTextTransform } from './message-bubble-selectors'

function useTextStreamIdle(enabled: boolean, textLength: number): boolean {
  const streamKey = enabled ? textLength : null
  const [idleStreamKey, setIdleStreamKey] = useState<number | null>(null)

  useEffect(() => {
    if (streamKey === null) {
      return
    }

    const timer = window.setTimeout(() => {
      setIdleStreamKey(streamKey)
    }, THINKING_IDLE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [streamKey])

  return streamKey !== null && idleStreamKey === streamKey
}

/* ─── Main Component ────────────────────────────────────────────── */

interface MessageBubbleProps {
  message: UIMessage
  isStreaming: boolean
  executionDetailsDefaultOpen?: boolean
  presentation?: 'thread' | 'export'
  onToolApprovalResponse?: MessageToolApprovalHandler
  debugCaption?: ReactNode
}

const MessageThinkingPlaceholderById = ({
  sessionId,
  messageId,
  isAssistant,
  isStreaming,
  segmentCount,
  segments,
  textTransform,
  suppressPlaceholder,
}: {
  sessionId: string
  messageId: string
  isAssistant: boolean
  isStreaming: boolean
  segmentCount: number
  segments: ChatRenderSegment[]
  textTransform?: MessageTextTransform
  suppressPlaceholder?: boolean
}) => {
  const textLength = useChatRenderStore(state =>
    readPlainTextLengthFromState(state, sessionId, messageId, textTransform))
  const hasActiveProgress = useChatRenderStore(state =>
    hasActiveNonTextSegmentProgress(state, sessionId, messageId, segments))
  const streamTextIdle = useTextStreamIdle(isAssistant && isStreaming, textLength)

  if (
    !isAssistant
    || !isStreaming
    || suppressPlaceholder
    || hasActiveProgress
    || (segmentCount !== 0 && !streamTextIdle)
  ) {
    return null
  }

  return <ThinkingPlaceholder />
}
MessageThinkingPlaceholderById.displayName = 'MessageThinkingPlaceholderById'

const MessageSegmentView = ({
  segment,
  sessionId,
  isUser,
  isActiveStreamingSegment,
  onToolApprovalResponse,
  onImageClick,
  textTransform,
}: {
  segment: ChatRenderSegment
  sessionId: string
  isUser: boolean
  isActiveStreamingSegment: boolean
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
  onImageClick?: () => void
  textTransform?: MessageTextTransform
}) => {
  switch (segment.kind) {
    case 'text':
      return (
        <MessageTextPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
          isUser={isUser}
          isActiveStreamingSegment={isActiveStreamingSegment}
          textTransform={textTransform}
        />
      )
    case 'reasoning':
      return (
        <MessageReasoningPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
          isActiveStreamingSegment={isActiveStreamingSegment}
        />
      )
    case 'tool-group':
      return (
        <GroupedToolCallBlockByPartIndexes
          items={segment.items}
          uiKind={segment.uiKind}
          sessionId={sessionId}
        />
      )
    case 'tool-call':
      return (
        <ToolCallBlockByPartIndex
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
          onToolApprovalResponse={onToolApprovalResponse}
        />
      )
    case 'file-attachment':
      return (
        <MessageFilePartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
          onImageClick={onImageClick}
        />
      )
    case 'skill-context':
      return (
        <MessageSkillContextPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
        />
      )
    case 'plugin-context':
      return (
        <MessagePluginContextPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
        />
      )
    case 'file-line-comment-context':
      return (
        <MessageFileLineCommentContextPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
        />
      )
    case 'runtime-warning':
      return (
        <MessageRuntimeWarningPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
        />
      )
    default:
      return null
  }
}
MessageSegmentView.displayName = 'MessageSegmentView'

const MessageBubbleSegmentsView = ({
  sessionId,
  frame,
  segments,
  isStreaming,
  imageAttachments,
  onToolApprovalResponse,
  editAction,
  textTransform,
}: {
  sessionId: string
  frame: MessageFrame
  segments: ChatRenderSegment[]
  isStreaming: boolean
  imageAttachments: MessageImageAttachment[]
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
  editAction?: MessageBubbleEditAction
  textTransform?: MessageTextTransform
}) => {
  const isUser = frame.role === 'user'
  const isAssistant = frame.role === 'assistant'
  const activeStreamingSegmentKey
    = isStreaming && !frame.hasHiddenRuntimeUserInputTail
      ? readActiveStreamingSegmentKey(segments)
      : null
  const executionPhaseSplit = isStreaming
    ? null
    : splitSegmentExecutionPhase(segments, {
        describeToolKind: part => describeToolCall(part).kind,
      })

  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const imageAttachmentBySegmentKey = new Map(
    imageAttachments.map(attachment => [attachment.segmentKey, attachment.part]),
  )
  const imageSegments = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => imageAttachmentBySegmentKey.has(segment.key))
  const lightboxImages = imageSegments.map(({ segment }) => {
    const part = imageAttachmentBySegmentKey.get(segment.key)
    return {
      url: part?.url ?? '',
      alt: part?.filename ?? part?.mediaType ?? 'Image',
    }
  })

  const handleImageClick = (segmentIndex: number) => {
    const imageIndex = imageSegments.findIndex(({ index }) => index === segmentIndex)
    if (imageIndex !== -1) {
      setLightboxIndex(imageIndex)
      setLightboxOpen(true)
    }
  }

  function renderSegment(segment: ChatRenderSegment, index: number) {
    return (
      <MessageSegmentView
        key={segment.key}
        segment={segment}
        sessionId={sessionId}
        isUser={isUser}
        isActiveStreamingSegment={segment.key === activeStreamingSegmentKey}
        onToolApprovalResponse={onToolApprovalResponse}
        onImageClick={
          segment.kind === 'file-attachment' ? () => handleImageClick(index) : undefined
        }
        textTransform={textTransform}
      />
    )
  }

  function renderSegmentsWithImageGrid(segs: ChatRenderSegment[]) {
    const result: React.ReactNode[] = []
    let imageBuffer: Array<{ segment: ChatRenderSegment, index: number }> = []

    segs.forEach((segment, index) => {
      const isImage = imageAttachmentBySegmentKey.has(segment.key)

      if (isImage) {
        imageBuffer.push({ segment, index })
      }
 else {
        if (imageBuffer.length > 0) {
          result.push(
            <div
              key={`image-grid-${imageBuffer[0].index}`}
              className="my-1 flex min-w-0 flex-wrap gap-2"
            >
              {imageBuffer.map(({ segment: imgSegment, index: imgIndex }) => (
                <div key={imgSegment.key} className={IMAGE_ATTACHMENT_GRID_ITEM_CLASS}>
                  {renderSegment(imgSegment, imgIndex)}
                </div>
              ))}
            </div>,
          )
          imageBuffer = []
        }
        result.push(renderSegment(segment, index))
      }
    })

    if (imageBuffer.length > 0) {
      result.push(
        <div
          key={`image-grid-${imageBuffer[0].index}`}
          className="my-1 flex min-w-0 flex-wrap gap-2"
        >
          {imageBuffer.map(({ segment: imgSegment, index: imgIndex }) => (
            <div key={imgSegment.key} className={IMAGE_ATTACHMENT_GRID_ITEM_CLASS}>
              {renderSegment(imgSegment, imgIndex)}
            </div>
          ))}
        </div>,
      )
    }

    return result
  }

  function renderContent() {
    if (frame.bangCommand) {
      return <BangCommandPromptBlock command={frame.bangCommand.command} />
    }

    if (frame.bangResult) {
      return <BangCommandBlock result={frame.bangResult} />
    }

    if (!executionPhaseSplit) {
      return renderSegmentsWithImageGrid(segments)
    }

    return (
      <>
        <ExecutionPhaseFold>
          {executionPhaseSplit.executionItems.map((segment, index) =>
            renderSegment(segment, index))}
        </ExecutionPhaseFold>
        {renderSegmentsWithImageGrid(executionPhaseSplit.finalItems)}
      </>
    )
  }

  return (
    <>
      <div
        // initial={isFirstAppearance ? { opacity: 0, y: 8 } : false}
        // animate={{ opacity: 1, y: 0 }}
        // transition={BUBBLE_TRANSITION}
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
            {renderContent()}
            <MessageThinkingPlaceholderById
              sessionId={sessionId}
              messageId={frame.id}
              isAssistant={isAssistant}
              isStreaming={isStreaming}
              segmentCount={segments.length}
              segments={segments}
              textTransform={textTransform}
              suppressPlaceholder={frame.hasHiddenRuntimeUserInputTail}
            />
          </div>

          {isAssistant && <RunDebugCaption messageId={frame.id} />}

          {!isStreaming && (
            <MessageBubbleActionsById
              sessionId={sessionId}
              messageId={frame.id}
              isUser={isUser}
              editAction={isUser ? editAction : undefined}
              textTransform={textTransform}
            />
          )}
        </div>
      </div>

      {lightboxImages.length > 0 && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
        />
      )}
    </>
  )
}
MessageBubbleSegmentsView.displayName = 'MessageBubbleSegmentsView'

export const MessageBubbleById = ({
  sessionId,
  messageId,
  onToolApprovalResponse,
  editAction,
  textTransform,
}: {
  sessionId: string | null
  messageId: string
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
  editAction?: MessageBubbleEditAction
  textTransform?: MessageTextTransform
}) => {
  const storeSessionId = sessionId ?? ''
  const frame = useChatRenderStore(
    state => readMessageFrameFromState(state, storeSessionId, messageId, textTransform),
    areMessageFramesEqual,
  )
  const segments = useChatRenderStore(
    state => readRenderSegmentsFromState(state, storeSessionId, messageId, textTransform),
    areRenderSegmentsEqual,
  )
  const isStreaming = useChatRenderStore(
    chatSelectors.isVisibleStreamingMessage(storeSessionId, messageId),
    (a, b) => a === b,
  )
  const imageAttachments = useChatRenderStore(
    state => readMessageImageAttachmentsFromState(state, storeSessionId, segments),
    areMessageImageAttachmentsEqual,
  )

  if (!frame) {
    return null
  }

  return (
    <MessageBubbleSegmentsView
      sessionId={storeSessionId}
      frame={frame}
      segments={segments}
      isStreaming={isStreaming}
      imageAttachments={imageAttachments}
      onToolApprovalResponse={onToolApprovalResponse}
      editAction={editAction}
      textTransform={textTransform}
    />
  )
}
MessageBubbleById.displayName = 'MessageBubbleById'

function MessageBubbleView({
  message,
  isStreaming,
  executionDetailsDefaultOpen = false,
  presentation = 'thread',
  onToolApprovalResponse,
  debugCaption,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isExportPresentation = presentation === 'export'
  const continuationMetadata = readChatContinuationMetadata(message)
  const isSteerMessage = isUser && continuationMetadata?.mode === 'steer'
  const isGoalMessage = isCodexGoalUserMessage(message)
  const bangCommand = isUser ? readBangCommandMetadata(message) : null
  const bangResult = isUser ? readBangResultMetadata(message) : null
  const plainText = readMessageDisplayText(message)
  const plainTextLength = plainText.length
  const streamTextIdle = useTextStreamIdle(isAssistant && isStreaming, plainTextLength)

  const groupedItems = groupMessageParts({
    parts: message.parts,
    messageId: message.id,
    describeToolKind: part => describeToolCall(part).kind,
  })
  const activeStreamingItemKey = isStreaming ? readActiveStreamingItemKey(groupedItems) : null

  const executionPhaseSplit = isStreaming
    ? null
    : splitExecutionPhase(groupedItems, {
        describeToolKind: part => describeToolCall(part).kind,
      })
  const hasActiveProgress = hasActiveNonTextProgress(groupedItems)
  const showThinkingPlaceholder
    = isAssistant
      && isStreaming
      && !hasActiveProgress
      && (groupedItems.length === 0 || streamTextIdle)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(plainText)
  }

  /* ─── Render items ─── */
  function renderItem(item: ChatRenderItem) {
    switch (item.kind) {
      case 'text':
        if (isUser) {
          return <UserMessageText key={item.key} text={item.text} />
        }
        return (
          <Streamdown
            key={item.key}
            content={item.text}
            streaming={item.key === activeStreamingItemKey}
            animationPreset={STREAMDOWN_RENDER_OPTIONS.animationPreset}
            animateMode={STREAMDOWN_RENDER_OPTIONS.animateMode}
            showCursor={STREAMDOWN_RENDER_OPTIONS.showCursor}
            animated={item.text.length <= MESSAGE_STREAMING_ANIMATION_MAX_CHARS}
            components={{
                a: props => <MarkdownFileLinkView {...readMarkdownAnchorProps(props)} />,
            }}
          />
        )

      case 'reasoning':
        return (
          <ReasoningBlock
            key={item.key}
            text={item.text}
            state={
              item.key === activeStreamingItemKey && item.state === 'streaming'
                ? 'streaming'
                : 'done'
            }
          />
        )

      case 'tool-group':
        return (
          <GroupedToolCallBlockView
            key={item.key}
            items={item.items}
            uiKind={item.uiKind}
          />
        )

      case 'tool-call':
        {
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
            onApprovalResponse={
              approval && onToolApprovalResponse
                ? response => onToolApprovalResponse({
                    messageId: message.id,
                    approvalId: response.id,
                    approved: response.approved,
                  })
                : undefined
            }
          />
        )
        }

      case 'file-attachment':
        return <FileAttachmentBlock key={item.key} part={item.part} />

      case 'skill-context':
        return <SkillContextBlock key={item.key} part={item.part} />
      case 'plugin-context':
        return <PluginContextBlock key={item.key} part={item.part} />
      case 'runtime-warning':
        return <RuntimeWarningBlock key={item.key} warning={item.part.data} />

      default:
        return null
    }
  }

  /* ─── Separate execution-phase items from final reply ─── */
  function renderContent() {
    if (bangCommand) {
      return <BangCommandPromptBlock command={bangCommand.command} />
    }

    if (bangResult) {
      return <BangCommandBlock result={bangResult} />
    }

    if (!executionPhaseSplit) {
      return groupedItems.map(renderItem)
    }

    if (isExportPresentation) {
      return executionPhaseSplit.finalItems.map(renderItem)
    }

    return (
      <>
        <ExecutionPhaseFold defaultOpen={executionDetailsDefaultOpen}>
          {executionPhaseSplit.executionItems.map(renderItem)}
        </ExecutionPhaseFold>
        {executionPhaseSplit.finalItems.map(renderItem)}
      </>
    )
  }

  return (
    <div
      // initial={!isExportPresentation && isFirstAppearance ? { opacity: 0, y: 8 } : false}
      // animate={{ opacity: 1, y: 0 }}
      // transition={BUBBLE_TRANSITION}
      data-testid={`message-bubble-${message.role}`}
      data-message-id={message.id}
      data-message-role={message.role}
      data-message-streaming={isStreaming ? 'true' : 'false'}
      className={cn('group flex w-full gap-3', isUser && 'justify-end')}
    >
      <div
        className={cn(
          'min-w-0',
          isUser && !isSteerMessage && !bangCommand && !bangResult && 'max-w-[70%]',
          (bangCommand || bangResult) && 'max-w-[78%]',
          isSteerMessage && STEER_MESSAGE_CONTAINER_CLASS,
          !isUser && 'w-full',
        )}
      >
        {isSteerMessage && <SteerMessageLabel />}
        {isGoalMessage && <GoalMessageLabel />}
        {/* Bubble */}
        <div
          className={cn(
            'rounded-lg text-sm leading-relaxed',
            isUser
            && !isSteerMessage
            && !bangCommand
            && !bangResult
            && 'bg-muted text-foreground rounded-br-sm px-3 py-2',
            (bangCommand || bangResult) && 'rounded-br-sm',
            isSteerMessage && STEER_MESSAGE_BUBBLE_CLASS,
            isAssistant && 'text-foreground',
          )}
        >
          {renderContent()}
          {showThinkingPlaceholder && <ThinkingPlaceholder />}
        </div>

        {isAssistant && debugCaption}

        {/* Action bar — appears on hover for all messages */}
        {!isExportPresentation && !isStreaming && plainText.length > 0 && (
          <MessageBubbleActionsView
            hasPlainText
            isUser={isUser}
            onCopy={handleCopy}
          />
        )}
      </div>
    </div>
  )
}

export const MessageBubble = MessageBubbleView
