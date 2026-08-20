import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { getChatRunsByRunIdSnapshotOptions } from '~/api-gen/@tanstack/react-query.gen'
import { chatSelectors } from '~/store/chat'

import { BangCommandBlock, BangCommandPromptBlock } from '../../rendering/blocks/bang-command-block'
import type { ChatRenderSegment } from '../../rendering/chat-render-plan'
import { splitSegmentExecutionPhase } from '../../rendering/chat-render-plan'
import { useChatRenderStore } from '../../rendering/chat-render-store'
import { ImageLightbox } from '../../rendering/image-lightbox'
import { ExecutionPhaseFold } from '../../rendering/message-bubble-chrome'
import type {
  MessageFrame,
  MessageImageAttachment,
  MessageTextTransform,
} from '../../rendering/message-bubble-selectors'
import { readActiveStreamingSegmentKey } from '../../rendering/message-bubble-selectors'
import { readRunSnapshotTimings } from '../../rendering/run-debug-timings'
import { describeToolCall } from '../../rendering/tool-ui-classifier'
import type { MessageBubbleByIdProps, MessageToolApprovalHandler } from '../lib/message-bubble-types'
import { MessageBubbleFrameView } from '../views/message-bubble-frame-view'
import { MessageBubbleActionsById } from './message-bubble-actions-by-id'
import { MessageBubbleSegment } from './message-bubble-segment'
import { MessageBubbleThinkingPlaceholderById } from './message-bubble-thinking-placeholder-by-id'
import { RunDebugCaptionById } from './run-debug-caption-by-id'

const IMAGE_ATTACHMENT_GRID_ITEM_CLASS = 'min-w-0 max-w-[300px] flex-1 basis-[calc(50%-0.25rem)]'

export interface MessageBubbleSegmentsContainerProps {
  sessionId: string
  frame: MessageFrame
  segments: ChatRenderSegment[]
  isStreaming: boolean
  imageAttachments: MessageImageAttachment[]
  onToolApprovalResponse?: MessageToolApprovalHandler
  editAction?: MessageBubbleByIdProps['editAction']
  textTransform?: MessageTextTransform
}

/** Runtime composition layer for a selected message frame and its bounded part adapters. */
export function MessageBubbleSegmentsContainer({
  sessionId,
  frame,
  segments,
  isStreaming,
  imageAttachments,
  onToolApprovalResponse,
  editAction,
  textTransform,
}: MessageBubbleSegmentsContainerProps) {
  const isUser = frame.role === 'user'
  const isAssistant = frame.role === 'assistant'
  const activeStreamingSegmentKey = isStreaming && !frame.hasHiddenRuntimeUserInputTail
    ? readActiveStreamingSegmentKey(segments)
    : null
  const executionPhaseSplit = isStreaming
    ? null
    : splitSegmentExecutionPhase(segments, { describeToolKind: part => describeToolCall(part).kind })
  const liveRunMeta = useChatRenderStore(chatSelectors.runDisplayMeta(frame.id), (a, b) => a === b)
  const effectiveRunId = liveRunMeta?.runId ?? frame.runId
  const { data: runSnapshot } = useQuery({
    ...getChatRunsByRunIdSnapshotOptions({ path: { runId: effectiveRunId ?? '' } }),
    enabled: isAssistant && !isStreaming && Boolean(effectiveRunId),
    refetchInterval: query => query.state.data?.status === 'running' ? 1000 : false,
    staleTime: 60_000,
  })
  const snapshotTimings = runSnapshot ? readRunSnapshotTimings(runSnapshot) : null
  // Never substitute legacy total duration for Worked: old messages retain
  // Done, while new compact projections preserve the correct execution bound.
  const workedMs = snapshotTimings?.workedMs ?? frame.runTimings?.workedMs ?? null
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const imageAttachmentBySegmentKey = new Map(imageAttachments.map(attachment => [attachment.segmentKey, attachment.part]))
  const imageSegments = segments.map((segment, index) => ({ segment, index })).filter(({ segment }) => imageAttachmentBySegmentKey.has(segment.key))
  const lightboxImages = imageSegments.map(({ segment }) => {
    const part = imageAttachmentBySegmentKey.get(segment.key)
    return {
      url: part?.url ?? '',
      alt: part?.filename ?? part?.mediaType ?? 'Image',
    }
  })

  const renderSegment = (segment: ChatRenderSegment, index: number) => (
    <MessageBubbleSegment
      key={segment.key}
      segment={segment}
      sessionId={sessionId}
      isUser={isUser}
      isActiveStreamingSegment={segment.key === activeStreamingSegmentKey}
      onToolApprovalResponse={onToolApprovalResponse}
      onImageClick={segment.kind === 'file-attachment'
? () => {
        const imageIndex = imageSegments.findIndex(({ index: imageSegmentIndex }) => imageSegmentIndex === index)
        if (imageIndex !== -1) {
          setLightboxIndex(imageIndex)
          setLightboxOpen(true)
        }
      }
: undefined}
      textTransform={textTransform}
    />
  )

  const renderSegmentsWithImageGrid = (items: ChatRenderSegment[]): ReactNode[] => {
    const result: ReactNode[] = []
    let imageBuffer: Array<{ segment: ChatRenderSegment, index: number }> = []
    items.forEach((segment, index) => {
      if (imageAttachmentBySegmentKey.has(segment.key)) {
        imageBuffer.push({ segment, index })
        return
      }
      if (imageBuffer.length > 0) {
        result.push(<div key={`image-grid-${imageBuffer[0].index}`} className="my-1 flex min-w-0 flex-wrap gap-2">{imageBuffer.map(({ segment: imageSegment, index: imageIndex }) => <div key={imageSegment.key} className={IMAGE_ATTACHMENT_GRID_ITEM_CLASS}>{renderSegment(imageSegment, imageIndex)}</div>)}</div>)
        imageBuffer = []
      }
      result.push(renderSegment(segment, index))
    })
    if (imageBuffer.length > 0) {
      result.push(<div key={`image-grid-${imageBuffer[0].index}`} className="my-1 flex min-w-0 flex-wrap gap-2">{imageBuffer.map(({ segment: imageSegment, index: imageIndex }) => <div key={imageSegment.key} className={IMAGE_ATTACHMENT_GRID_ITEM_CLASS}>{renderSegment(imageSegment, imageIndex)}</div>)}</div>)
    }
    return result
  }

  const content = frame.bangCommand
    ? <BangCommandPromptBlock command={frame.bangCommand.command} />
    : frame.bangResult
      ? <BangCommandBlock result={frame.bangResult} />
      : !executionPhaseSplit
        ? renderSegmentsWithImageGrid(segments)
        : (
            <>
              <ExecutionPhaseFold durationMs={workedMs}>{executionPhaseSplit.executionItems.map(renderSegment)}</ExecutionPhaseFold>
              {renderSegmentsWithImageGrid(executionPhaseSplit.finalItems)}
            </>
          )

  return (
    <>
      <MessageBubbleFrameView
        frame={frame}
        isStreaming={isStreaming}
        content={content}
        thinkingPlaceholder={<MessageBubbleThinkingPlaceholderById sessionId={sessionId} messageId={frame.id} isAssistant={isAssistant} isStreaming={isStreaming} segments={segments} textTransform={textTransform} suppressPlaceholder={frame.hasHiddenRuntimeUserInputTail} />}
        runTelemetryCaption={isAssistant ? <RunDebugCaptionById messageId={frame.id} persistedRunId={frame.runId} persistedTimings={frame.runTimings} /> : undefined}
        actions={!isStreaming ? <MessageBubbleActionsById sessionId={sessionId} messageId={frame.id} isUser={isUser} editAction={isUser ? editAction : undefined} textTransform={textTransform} /> : undefined}
      />
      {lightboxImages.length > 0 && <ImageLightbox images={lightboxImages} sessionId={sessionId} initialIndex={lightboxIndex} open={lightboxOpen} onOpenChange={setLightboxOpen} />}
    </>
  )
}
