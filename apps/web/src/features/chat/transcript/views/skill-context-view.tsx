import type { ChatSkillContextMessagePart } from '../../context/chat-context-parts'
import { readSkillContextLabel, readSkillContextPart } from '../../context/chat-context-parts'
import { SkillMentionToken } from '../../mentions/skill-mention-token'

export interface SkillContextViewProps { part: ChatSkillContextMessagePart }

export function SkillContextView({ part }: SkillContextViewProps) {
  const skill = readSkillContextPart(part)
  return skill ? <SkillMentionToken name={readSkillContextLabel(skill)} className="mx-1" /> : null
}
