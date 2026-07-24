import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readFileLineCommentContextPartFromState } from '../../rendering/message-bubble-selectors'
import { FileLineCommentContextView } from '../views/file-line-comment-context-view'

export interface MessageFileLineCommentContextPartByIdProps { sessionId: string, messageId: string, partIndex: number }

export function MessageFileLineCommentContextPartById({ sessionId, messageId, partIndex }: MessageFileLineCommentContextPartByIdProps) {
  const part = useChatRenderStore(state => readFileLineCommentContextPartFromState(state, sessionId, messageId, partIndex))
  return part ? <FileLineCommentContextView part={part} /> : null
}
