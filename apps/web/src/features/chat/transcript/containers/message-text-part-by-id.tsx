import { Streamdown } from '@cradle/streamdown'

import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import { useChatRenderStore } from '../../rendering/chat-render-store'
import { MarkdownFileLink } from '../../rendering/markdown-file-link'
import type { MessageTextTransform } from '../../rendering/message-bubble-selectors'
import { readMarkdownAnchorProps, readTextPartFromState } from '../../rendering/message-bubble-selectors'
import { MESSAGE_STREAMING_ANIMATION_MAX_CHARS } from '../../rendering/message-rendering-constants'
import { UserMessageText } from '../../rendering/user-message-text'

export interface MessageTextPartByIdProps { sessionId: string, messageId: string, partIndex: number, isUser: boolean, isActiveStreamingSegment: boolean, textTransform?: MessageTextTransform }

export function MessageTextPartById({ sessionId, messageId, partIndex, isUser, isActiveStreamingSegment, textTransform }: MessageTextPartByIdProps) {
  const text = useChatRenderStore(state => readTextPartFromState(state, sessionId, messageId, partIndex, textTransform))
  if (isUser) { return <UserMessageText text={text} /> }
  return <Streamdown content={text} streaming={isActiveStreamingSegment} animationPreset={STREAMDOWN_RENDER_OPTIONS.animationPreset} animateMode={STREAMDOWN_RENDER_OPTIONS.animateMode} showCursor={STREAMDOWN_RENDER_OPTIONS.showCursor} animated={text.length <= MESSAGE_STREAMING_ANIMATION_MAX_CHARS} components={{ a: props => <MarkdownFileLink {...readMarkdownAnchorProps(props)} sessionId={sessionId} /> }} />
}
