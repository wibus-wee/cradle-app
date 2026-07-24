import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readSkillContextPartFromState } from '../../rendering/message-bubble-selectors'
import { SkillContextView } from '../views/skill-context-view'

export interface MessageSkillContextPartByIdProps { sessionId: string, messageId: string, partIndex: number }

export function MessageSkillContextPartById({ sessionId, messageId, partIndex }: MessageSkillContextPartByIdProps) {
  const part = useChatRenderStore(state => readSkillContextPartFromState(state, sessionId, messageId, partIndex))
  return part ? <SkillContextView part={part} /> : null
}
