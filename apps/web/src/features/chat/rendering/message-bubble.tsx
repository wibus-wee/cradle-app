import { Streamdown } from '@cradle/streamdown'
import {
  BookmarkLine as BookmarkIcon,
  BookmarksLine as MarkerIcon,
  CheckLine as CheckIcon,
  CopyLine as CopyIcon,
  PencilLine as PencilIcon,
} from '@mingcute/react'
import type { UIMessage } from 'ai'
import { useEffect, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { sessionEnvironmentApi } from '~/features/session-environment/api/session-environment'
import { cn } from '~/lib/cn'
import { chatSelectors } from '~/store/chat'
import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import { readChatContinuationMetadata } from '../capabilities/chat-continuation-metadata'
import { readBangCommandMetadata, readBangResultMetadata } from '../commands/bang-command-metadata'
import { BangCommandBlock, BangCommandPromptBlock } from './blocks/bang-command-block'
import { ReasoningBlock } from './blocks/reasoning-block'
import { RuntimeWarningBlock } from './blocks/runtime-warning-block'
import type { ChatRenderItem, ChatRenderSegment } from './chat-render-plan'
import {
  groupMessageParts,
  splitExecutionPhase,
  splitSegmentExecutionPhase,
} from './chat-render-plan'
import { useChatRenderStore, useChatRenderStoreApi } from './chat-render-store'
import { ImageLightbox } from './image-lightbox'
import { MarkdownFileLink } from './markdown-file-link'
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
import type { MessageFrame, MessageTextTransform } from './message-bubble-selectors'
import {
  areMessageFramesEqual,
  areRenderSegmentsEqual,
  hasActiveNonTextProgress,
  hasActiveNonTextSegmentProgress,
  isCodexGoalUserMessage,
  readActiveStreamingItemKey,
  readActiveStreamingSegmentKey,
  readFilePartFromState,
  readMarkdownAnchorProps,
  readMessageDisplayText,
  readMessageFrameFromState,
  readPlainTextFromState,
  readPlainTextLengthFromState,
  readPlainTextPresenceFromState,
  readRenderSegmentsFromState,
  readUserDisplayText,
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
  GroupedToolCallBlockFromParts,
  ToolCallBlockByPartIndex,
  ToolCallBlockFromPart,
} from './message-tool-blocks'
import { RunDebugCaption } from './run-debug-caption'
import { describeToolCall } from './tool-ui-classifier'

export { ChatRenderStoreProvider } from './chat-render-store'

const THINKING_IDLE_DELAY_MS = 900
const STEER_MESSAGE_CONTAINER_CLASS = 'max-w-[78%]'
const STEER_MESSAGE_BUBBLE_CLASS
  = 'rounded-br-sm bg-background px-3 py-2 text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)/0.45)]'
const IMAGE_ATTACHMENT_GRID_ITEM_CLASS = 'min-w-0 max-w-[300px] flex-1 basis-[calc(50%-0.25rem)]'

export type { MessageTextTransform } from './message-bubble-selectors'

export interface MessageBubbleEditAction {
  busy: boolean
  disabled: boolean
  label: string
  title: string
  onEdit: () => void
}

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
  sessionId?: string
  onToolApprovalResponse?: MessageToolApprovalHandler
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

const MessageCopyActionById = ({
  sessionId,
  messageId,
  isUser,
  editAction,
  textTransform,
}: {
  sessionId: string
  messageId: string
  isUser: boolean
  editAction?: MessageBubbleEditAction
  textTransform?: MessageTextTransform
}) => {
  const hasPlainText = useChatRenderStore(state =>
    readPlainTextPresenceFromState(state, sessionId, messageId, textTransform))
  const chatStore = useChatRenderStoreApi()
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    const plainText = readPlainTextFromState(
      chatStore.getState(),
      sessionId,
      messageId,
      textTransform,
    )
    await navigator.clipboard.writeText(plainText)
    setCopied(true)

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copyFeedbackTimerRef.current = null
    }, 1500)
  }

  const handlePin = async () => {
    const result = await sessionEnvironmentApi.pinMessage({
      path: { id: sessionId, messageId },
    })
    if (result.error) {
      toastManager.add({ type: 'error', title: 'Pin failed', description: String(result.error) })
      return
    }
    toastManager.add({ type: 'success', title: 'Message pinned' })
  }

  const handleMarkSelection = async () => {
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const bubble = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    const content = bubble?.querySelector('[data-message-content]')
    if (
      !selection
      || !range
      || !content
      || selection.isCollapsed
      || !content.contains(range.startContainer)
      || !content.contains(range.endContainer)
    ) {
      toastManager.add({ type: 'error', title: 'Select text in this message first' })
      return
    }
    const startRange = document.createRange()
    startRange.selectNodeContents(content)
    startRange.setEnd(range.startContainer, range.startOffset)
    const endRange = document.createRange()
    endRange.selectNodeContents(content)
    endRange.setEnd(range.endContainer, range.endOffset)
    const selectedText = range.toString()
    const result = await sessionEnvironmentApi.createMarker({
      path: { id: sessionId },
      body: {
        messageId,
        startOffset: startRange.toString().length,
        endOffset: endRange.toString().length,
        selectedText,
        style: 'highlight',
        color: 'yellow',
      },
    })
    if (result.error) {
      toastManager.add({ type: 'error', title: 'Marker failed', description: String(result.error) })
      return
    }
    selection.removeAllRanges()
    toastManager.add({ type: 'success', title: 'Selection marked' })
  }

  if (!hasPlainText && !editAction) {
    return null
  }

  return (
    <div
      className={cn(
        'mt-1 flex items-center gap-0.5 opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-[opacity,transform] duration-150',
        isUser && 'justify-end',
      )}
    >
      {editAction && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={editAction.disabled}
          onClick={editAction.onEdit}
          className="text-muted-foreground/50 hover:text-foreground"
          title={editAction.title}
          aria-label={editAction.label}
          data-testid="chat-edit-previous-btn"
        >
          {editAction.busy
? (
            <Spinner className="size-3.5" aria-hidden="true" />
          )
: (
            <PencilIcon className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      )}
      {hasPlainText && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void handlePin()}
          className="text-muted-foreground/50 hover:text-foreground"
          aria-label="Pin message"
          title="Pin in environment"
        >
          <BookmarkIcon className="size-3.5" aria-hidden="true" />
        </Button>
      )}
      {hasPlainText && isUser && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void handleMarkSelection()}
          className="text-muted-foreground/50 hover:text-foreground"
          aria-label="Mark selected text"
          title="Mark selected text in environment"
        >
          <MarkerIcon className="size-3.5" aria-hidden="true" />
        </Button>
      )}
      {hasPlainText && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleCopy}
          className="text-muted-foreground/50 hover:text-foreground"
          aria-label="Copy message"
        >
          {copied
? (
            <CheckIcon className="size-3.5 !text-emerald-500" aria-hidden="true" />
          )
: (
            <CopyIcon className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      )}
    </div>
  )
}
MessageCopyActionById.displayName = 'MessageCopyActionById'

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
  onToolApprovalResponse,
  editAction,
  textTransform,
}: {
  sessionId: string
  frame: MessageFrame
  segments: ChatRenderSegment[]
  isStreaming: boolean
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
  editAction?: MessageBubbleEditAction
  textTransform?: MessageTextTransform
}) => {
  const chatStore = useChatRenderStoreApi()
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

  const imageSegments = (() => {
    return segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => {
        if (segment.kind !== 'file-attachment') {
          return false
        }
        const part = readFilePartFromState(
          chatStore.getState(),
          sessionId,
          segment.messageId,
          segment.partIndex,
        )
        return part?.mediaType.startsWith('image/')
      })
  })()

  const lightboxImages = (() => {
    return imageSegments.map(({ segment }) => {
      if (segment.kind !== 'file-attachment') {
        return { url: '', alt: '' }
      }
      const part = readFilePartFromState(
        chatStore.getState(),
        sessionId,
        segment.messageId,
        segment.partIndex,
      )
      return {
        url: part?.url ?? '',
        alt: part?.filename ?? part?.mediaType ?? 'Image',
      }
    })
  })()

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
      const isImage
        = segment.kind === 'file-attachment'
          && (() => {
          if (segment.kind !== 'file-attachment') {
            return false
          }
          const part = readFilePartFromState(
            chatStore.getState(),
            sessionId,
            segment.messageId,
            segment.partIndex,
          )
          return part?.mediaType.startsWith('image/')
        })()

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
            <MessageCopyActionById
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

  if (!frame) {
    return null
  }

  return (
    <MessageBubbleSegmentsView
      sessionId={storeSessionId}
      frame={frame}
      segments={segments}
      isStreaming={isStreaming}
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
  sessionId,
  onToolApprovalResponse,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isExportPresentation = presentation === 'export'
  const continuationMetadata = readChatContinuationMetadata(message)
  const isSteerMessage = isUser && continuationMetadata?.mode === 'steer'
  const isGoalMessage = isCodexGoalUserMessage(message)
  const bangCommand = isUser ? readBangCommandMetadata(message) : null
  const bangResult = isUser ? readBangResultMetadata(message) : null
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimerRef = useRef<number | null>(null)

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

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(plainText)
    setCopied(true)

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copyFeedbackTimerRef.current = null
    }, 1500)
  }

  /* ─── Render items ─── */
  function renderItem(item: ChatRenderItem) {
    switch (item.kind) {
      case 'text':
        if (isUser) {
          const displayText = readUserDisplayText(item.text)
          return (
            <span key={item.key} className="whitespace-pre-wrap wrap-break-word">
              {displayText}
            </span>
          )
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
              a: props => (
                <MarkdownFileLink {...readMarkdownAnchorProps(props)} sessionId={sessionId} />
              ),
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
          <GroupedToolCallBlockFromParts
            key={item.key}
            items={item.items}
            uiKind={item.uiKind}
            sessionId={sessionId}
          />
        )

      case 'tool-call':
        return (
          <ToolCallBlockFromPart
            key={item.key}
            messageId={message.id}
            part={item.part}
            sessionId={sessionId}
            onToolApprovalResponse={onToolApprovalResponse}
          />
        )

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

        {isAssistant && <RunDebugCaption messageId={message.id} />}

        {/* Action bar — appears on hover for all messages */}
        {!isExportPresentation && !isStreaming && plainText.length > 0 && (
          <div
            className={cn(
              'mt-1 flex items-center gap-0.5 opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-[opacity,transform] duration-150',
              isUser && 'justify-end',
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleCopy}
              className="text-muted-foreground/50 hover:text-foreground"
              aria-label="Copy message"
            >
              {copied
? (
                <CheckIcon className="size-3.5 !text-emerald-500" aria-hidden="true" />
              )
: (
                <CopyIcon className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export const MessageBubble = MessageBubbleView
