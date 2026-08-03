import type { ChatIntentContextMessagePart } from '../../context/chat-context-parts'
import { readIntentContextLabel, readIntentContextPart } from '../../context/chat-context-parts'
import { IntentMentionToken } from '../../mentions/intent-mention-token'

export interface IntentContextViewProps { part: ChatIntentContextMessagePart }

export function IntentContextView({ part }: IntentContextViewProps) {
  const intent = readIntentContextPart(part)
  return intent
    ? <IntentMentionToken name={intent.name || readIntentContextLabel(intent)} className="mx-1" />
    : null
}
