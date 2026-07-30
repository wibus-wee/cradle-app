import { Streamdown } from '@cradle/streamdown'

import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import { BlobOverflowNotice } from './blob-overflow-notice'
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
  readFileLineCommentContextPartFromState,
  readFilePartFromState,
  readMarkdownAnchorProps,
  readPluginContextPartFromState,
  readRuntimeWarningPartFromState,
  readSkillContextPartFromState,
  readTextPartFromState,
  readTextPartOverflowFromState,
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
  const overflow = useChatRenderStore(state =>
    readTextPartOverflowFromState(state, sessionId, messageId, partIndex, textTransform))
  const animated = text.length <= MESSAGE_STREAMING_ANIMATION_MAX_CHARS

  if (isUser) {
    return (
      <div className="flex flex-col gap-1">
        <UserMessageText text={text} />
        {overflow && (
          <BlobOverflowNotice
            truncatedOriginalChars={overflow.originalChars}
            blobId={overflow.blobId}
            sessionId={sessionId}
            fullLabel="open full message"
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
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
      {overflow && (
        <BlobOverflowNotice
          truncatedOriginalChars={overflow.originalChars}
          blobId={overflow.blobId}
          sessionId={sessionId}
          fullLabel="open full message"
        />
      )}
    </div>
  )
}
MessageTextPartById.displayName = 'MessageTextPartById'

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
  return <FileAttachmentBlock part={part} sessionId={sessionId} onClick={onImageClick} />
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
