import { Streamdown } from '@cradle/streamdown'

import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import { ReasoningBlock } from './blocks/reasoning-block'
import { RuntimeWarningBlock } from './blocks/runtime-warning-block'
import { useChatRenderStore } from './chat-render-store'
import { MarkdownFileLink } from './markdown-file-link'
import {
  FileAttachmentBlock,
  FileLineCommentContextBlock,
  PluginContextBlock,
  SkillContextBlock,
} from './message-attachment-blocks'
import type { MessageTextTransform } from './message-bubble-selectors'
import {
  areReasoningPartsEqual,
  readFileLineCommentContextPartFromState,
  readFilePartFromState,
  readMarkdownAnchorProps,
  readPluginContextPartFromState,
  readReasoningPartFromState,
  readRuntimeWarningPartFromState,
  readSkillContextPartFromState,
  readTextPartFromState,
} from './message-bubble-selectors'
import { MESSAGE_STREAMING_ANIMATION_MAX_CHARS } from './message-rendering-constants'
import { UserMessageText } from './user-message-text'

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
  const animated = text.length <= MESSAGE_STREAMING_ANIMATION_MAX_CHARS

  if (isUser) {
    return <UserMessageText text={text} />
  }

  return (
    <Streamdown
      content={text}
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

export const MessageFileLineCommentContextPartById = ({
  sessionId,
  messageId,
  partIndex,
}: {
  sessionId: string
  messageId: string
  partIndex: number
}) => {
  const part = useChatRenderStore(state =>
    readFileLineCommentContextPartFromState(state, sessionId, messageId, partIndex))
  if (!part) {
    return null
  }
  return <FileLineCommentContextBlock part={part} />
}
MessageFileLineCommentContextPartById.displayName = 'MessageFileLineCommentContextPartById'

export const MessageRuntimeWarningPartById = ({
  sessionId,
  messageId,
  partIndex,
}: {
  sessionId: string
  messageId: string
  partIndex: number
}) => {
  const part = useChatRenderStore(state =>
    readRuntimeWarningPartFromState(state, sessionId, messageId, partIndex))
  return part ? <RuntimeWarningBlock warning={part.data} /> : null
}
MessageRuntimeWarningPartById.displayName = 'MessageRuntimeWarningPartById'
