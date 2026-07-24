import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readPluginContextPartFromState } from '../../rendering/message-bubble-selectors'
import { PluginContextView } from '../views/plugin-context-view'

export interface MessagePluginContextPartByIdProps { sessionId: string, messageId: string, partIndex: number }

export function MessagePluginContextPartById({ sessionId, messageId, partIndex }: MessagePluginContextPartByIdProps) {
  const part = useChatRenderStore(state => readPluginContextPartFromState(state, sessionId, messageId, partIndex))
  return part ? <PluginContextView part={part} /> : null
}
