import { ReasoningBlock } from '../../rendering/blocks/reasoning-block'
import { useChatRenderStore } from '../../rendering/chat-render-store'
import { areReasoningPartsEqual, readReasoningPartFromState } from '../../rendering/message-bubble-selectors'

export interface MessageReasoningPartByIdProps { sessionId: string, messageId: string, partIndex: number, isActiveStreamingSegment: boolean }

export function MessageReasoningPartById({ sessionId, messageId, partIndex, isActiveStreamingSegment }: MessageReasoningPartByIdProps) {
  const part = useChatRenderStore(state => readReasoningPartFromState(state, sessionId, messageId, partIndex), areReasoningPartsEqual)
  return <ReasoningBlock text={part.text} state={isActiveStreamingSegment && part.state === 'streaming' ? 'streaming' : 'done'} />
}
