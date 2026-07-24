import type { SkillScope } from './types'

export type EditableSkillScope = 'workspace' | 'agent'

export interface SelectedSkillRef {
  scope: SkillScope
  name: string
}
