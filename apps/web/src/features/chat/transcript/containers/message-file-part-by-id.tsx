import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readFilePartFromState } from '../../rendering/message-bubble-selectors'
import { FileAttachmentView } from '../views/file-attachment-view'

export interface MessageFilePartByIdProps { sessionId: string, messageId: string, partIndex: number, onImageClick?: () => void }

export function MessageFilePartById({ sessionId, messageId, partIndex, onImageClick }: MessageFilePartByIdProps) {
  const part = useChatRenderStore(state => readFilePartFromState(state, sessionId, messageId, partIndex))
  return part ? <FileAttachmentView part={part} onClick={onImageClick} /> : null
}
