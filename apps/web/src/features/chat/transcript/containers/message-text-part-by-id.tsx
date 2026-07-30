import { Streamdown } from '@cradle/streamdown'

import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import { BlobOverflowNotice } from '../../rendering/blob-overflow-notice'
import { useChatRenderStore } from '../../rendering/chat-render-store'
import { MarkdownFileLink } from '../../rendering/markdown-file-link'
import type { MessageTextTransform } from '../../rendering/message-bubble-selectors'
import {
  readMarkdownAnchorProps,
  readPartOverflowNotice,
  readTextPartFromState,
  readTextPartOverflowFromState,
} from '../../rendering/message-bubble-selectors'
import { MESSAGE_STREAMING_ANIMATION_MAX_CHARS } from '../../rendering/message-rendering-constants'
import { UserMessageText } from '../../rendering/user-message-text'
import { useMessagePartAt } from '../lib/message-display-parts-context'

export interface MessageTextPartByIdProps { sessionId: string, messageId: string, partIndex: number, isUser: boolean, isActiveStreamingSegment: boolean, textTransform?: MessageTextTransform }

export function MessageTextPartById({ sessionId, messageId, partIndex, isUser, isActiveStreamingSegment, textTransform }: MessageTextPartByIdProps) {
  const displayPart = useMessagePartAt(partIndex)
  const storeText = useChatRenderStore((state) => {
    if (displayPart !== undefined) {
      return ''
    }
    return readTextPartFromState(state, sessionId, messageId, partIndex, textTransform)
  })
  const storeOverflow = useChatRenderStore((state) => {
    if (displayPart !== undefined) {
      return null
    }
    return readTextPartOverflowFromState(state, sessionId, messageId, partIndex, textTransform)
  })
  const text = displayPart !== undefined
    ? (displayPart?.type === 'text' ? displayPart.text : '')
    : storeText
  const overflow = displayPart !== undefined
    ? readPartOverflowNotice(displayPart)
    : storeOverflow

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
        animated={text.length <= MESSAGE_STREAMING_ANIMATION_MAX_CHARS}
        components={{ a: props => <MarkdownFileLink {...readMarkdownAnchorProps(props)} sessionId={sessionId} /> }}
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
