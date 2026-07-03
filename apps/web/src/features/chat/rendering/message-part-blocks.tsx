import { Streamdown } from '@cradle/streamdown'

import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import { ReasoningBlock } from './blocks/reasoning-block'
import { useChatRenderStore } from './chat-render-store'
import { MarkdownFileLink } from './markdown-file-link'
import { FileAttachmentBlock, PluginContextBlock, SkillContextBlock } from './message-attachment-blocks'
import type { MessageTextTransform } from './message-bubble-selectors'
import {
  areReasoningPartsEqual,
  readFilePartFromState,
  readMarkdownAnchorProps,
  readPluginContextPartFromState,
  readReasoningPartFromState,
  readSkillContextPartFromState,
  readTextPartFromState,
  readUserDisplayText,
} from './message-bubble-selectors'
import { MESSAGE_STREAMING_ANIMATION_MAX_CHARS } from './message-rendering-constants'

export const MessageTextPartById = ({
  sessionId,
  messageId,
  partIndex,
  isUser,
  isActiveStreamingSegment,
  textTransform,
}: {
  sessionId: string
  messageId: string
  partIndex: number
  isUser: boolean
  isActiveStreamingSegment: boolean
  textTransform?: MessageTextTransform
}) => {
  const text = useChatRenderStore(state =>
    readTextPartFromState(state, sessionId, messageId, partIndex, textTransform))
  const displayText = isUser ? readUserDisplayText(text) : text
  const animated = displayText.length <= MESSAGE_STREAMING_ANIMATION_MAX_CHARS

  if (isUser) {
    return <span className="whitespace-pre-wrap wrap-break-word">{displayText}</span>
  }

  return (
    <Streamdown
      content={displayText}
      streaming={isActiveStreamingSegment}
      animationPreset={STREAMDOWN_RENDER_OPTIONS.animationPreset}
      animateMode={STREAMDOWN_RENDER_OPTIONS.animateMode}
      showCursor={STREAMDOWN_RENDER_OPTIONS.showCursor}
      animated={animated}
      components={{
        a: props => <MarkdownFileLink {...readMarkdownAnchorProps(props)} sessionId={sessionId} />,
      }}
    />
  )
}
MessageTextPartById.displayName = 'MessageTextPartById'

export const MessageReasoningPartById = ({
  sessionId,
  messageId,
  partIndex,
  isActiveStreamingSegment,
}: {
  sessionId: string
  messageId: string
  partIndex: number
  isActiveStreamingSegment: boolean
}) => {
  const part = useChatRenderStore(
    state => readReasoningPartFromState(state, sessionId, messageId, partIndex),
    areReasoningPartsEqual,
  )
  const state = isActiveStreamingSegment && part.state === 'streaming' ? 'streaming' : 'done'

  return <ReasoningBlock text={part.text} state={state} />
}
MessageReasoningPartById.displayName = 'MessageReasoningPartById'

export const MessageFilePartById = ({
  sessionId,
  messageId,
  partIndex,
  onImageClick,
}: {
  sessionId: string
  messageId: string
  partIndex: number
  onImageClick?: () => void
}) => {
  const part = useChatRenderStore(state =>
    readFilePartFromState(state, sessionId, messageId, partIndex))
  if (!part) {
    return null
  }
  return <FileAttachmentBlock part={part} onClick={onImageClick} />
}
MessageFilePartById.displayName = 'MessageFilePartById'

export const MessageSkillContextPartById = ({
  sessionId,
  messageId,
  partIndex,
}: {
  sessionId: string
  messageId: string
  partIndex: number
}) => {
  const part = useChatRenderStore(state =>
    readSkillContextPartFromState(state, sessionId, messageId, partIndex))
  if (!part) {
    return null
  }
  return <SkillContextBlock part={part} />
}
MessageSkillContextPartById.displayName = 'MessageSkillContextPartById'

export const MessagePluginContextPartById = ({
  sessionId,
  messageId,
  partIndex,
}: {
  sessionId: string
  messageId: string
  partIndex: number
}) => {
  const part = useChatRenderStore(state =>
    readPluginContextPartFromState(state, sessionId, messageId, partIndex))
  if (!part) {
    return null
  }
  return <PluginContextBlock part={part} />
}
MessagePluginContextPartById.displayName = 'MessagePluginContextPartById'
