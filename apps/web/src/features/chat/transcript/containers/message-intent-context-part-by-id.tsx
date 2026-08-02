import { isChatIntentContextPart } from '../../context/chat-context-parts'
import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readIntentContextPartFromState } from '../../rendering/message-bubble-selectors'
import { useMessagePartAt } from '../lib/message-display-parts-context'
import { IntentContextView } from '../views/intent-context-view'

export interface MessageIntentContextPartByIdProps { sessionId: string, messageId: string, partIndex: number }

export function MessageIntentContextPartById({ sessionId, messageId, partIndex }: MessageIntentContextPartByIdProps) {
  const displayPart = useMessagePartAt(partIndex)
  const storePart = useChatRenderStore((state) => {
    if (displayPart !== undefined) {
      return null
    }
    return readIntentContextPartFromState(state, sessionId, messageId, partIndex)
  })
  const part = displayPart !== undefined
    ? (isChatIntentContextPart(displayPart) ? displayPart : null)
    : storePart
  return part ? <IntentContextView part={part} /> : null
}
