import type { ChatRenderSegment } from '../../rendering/chat-render-plan'
import type { MessageTextTransform } from '../../rendering/message-bubble-selectors'
import {
  GroupedToolCallBlockByPartIndexes,
  ToolCallBlockByPartIndex,
} from '../../rendering/message-tool-blocks'
import type { MessageToolApprovalHandler } from '../lib/message-bubble-types'
import { MessageFileLineCommentContextPartById } from './message-file-line-comment-context-part-by-id'
import { MessageFilePartById } from './message-file-part-by-id'
import { MessagePluginContextPartById } from './message-plugin-context-part-by-id'
import { MessageReasoningPartById } from './message-reasoning-part-by-id'
import { MessageRuntimeWarningPartById } from './message-runtime-warning-part-by-id'
import { MessageSkillContextPartById } from './message-skill-context-part-by-id'
import { MessageTextPartById } from './message-text-part-by-id'

export interface MessageBubbleSegmentProps {
  segment: ChatRenderSegment
  sessionId: string
  isUser: boolean
  isActiveStreamingSegment: boolean
  onToolApprovalResponse?: MessageToolApprovalHandler
  onImageClick?: () => void
  textTransform?: MessageTextTransform
}

/** Chooses the bounded per-part runtime adapter for a render-plan segment. */
export function MessageBubbleSegment({
  segment,
  sessionId,
  isUser,
  isActiveStreamingSegment,
  onToolApprovalResponse,
  onImageClick,
  textTransform,
}: MessageBubbleSegmentProps) {
  switch (segment.kind) {
    case 'text':
      return <MessageTextPartById sessionId={sessionId} messageId={segment.messageId} partIndex={segment.partIndex} isUser={isUser} isActiveStreamingSegment={isActiveStreamingSegment} textTransform={textTransform} />
    case 'reasoning':
      return <MessageReasoningPartById sessionId={sessionId} messageId={segment.messageId} partIndex={segment.partIndex} isActiveStreamingSegment={isActiveStreamingSegment} />
    case 'tool-group':
      return <GroupedToolCallBlockByPartIndexes items={segment.items} uiKind={segment.uiKind} sessionId={sessionId} />
    case 'tool-call':
      return <ToolCallBlockByPartIndex sessionId={sessionId} messageId={segment.messageId} partIndex={segment.partIndex} onToolApprovalResponse={onToolApprovalResponse} />
    case 'file-attachment':
      return <MessageFilePartById sessionId={sessionId} messageId={segment.messageId} partIndex={segment.partIndex} onImageClick={onImageClick} />
    case 'skill-context':
      return <MessageSkillContextPartById sessionId={sessionId} messageId={segment.messageId} partIndex={segment.partIndex} />
    case 'plugin-context':
      return <MessagePluginContextPartById sessionId={sessionId} messageId={segment.messageId} partIndex={segment.partIndex} />
    case 'file-line-comment-context':
      return <MessageFileLineCommentContextPartById sessionId={sessionId} messageId={segment.messageId} partIndex={segment.partIndex} />
    case 'runtime-warning':
      return <MessageRuntimeWarningPartById sessionId={sessionId} messageId={segment.messageId} partIndex={segment.partIndex} />
    default:
      return null
  }
}
