import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readFilePartFromState } from '../../rendering/message-bubble-selectors'
import { useMessagePartAt } from '../lib/message-display-parts-context'
import { FileAttachmentView } from '../views/file-attachment-view'

export interface MessageFilePartByIdProps { sessionId: string, messageId: string, partIndex: number, onImageClick?: () => void }

export function MessageFilePartById({ sessionId, messageId, partIndex, onImageClick }: MessageFilePartByIdProps) {
  const displayPart = useMessagePartAt(partIndex)
  const storePart = useChatRenderStore((state) => {
    if (displayPart !== undefined) {
      return null
    }
    return readFilePartFromState(state, sessionId, messageId, partIndex)
  })
  const part = displayPart !== undefined
    ? (displayPart?.type === 'file' ? displayPart : null)
    : storePart
  return part
    ? <FileAttachmentView part={part} sessionId={sessionId} onClick={onImageClick} />
    : null
}
