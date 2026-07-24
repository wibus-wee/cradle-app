import { RuntimeWarningBlock } from '../../rendering/blocks/runtime-warning-block'
import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readRuntimeWarningPartFromState } from '../../rendering/message-bubble-selectors'

export interface MessageRuntimeWarningPartByIdProps { sessionId: string, messageId: string, partIndex: number }

export function MessageRuntimeWarningPartById({ sessionId, messageId, partIndex }: MessageRuntimeWarningPartByIdProps) {
  const part = useChatRenderStore(state => readRuntimeWarningPartFromState(state, sessionId, messageId, partIndex))
  return part ? <RuntimeWarningBlock warning={part.data} /> : null
}
