import type { DiscoveredSkill } from './types'

export type SkillImportDialogStep = 'input' | 'fetching' | 'select' | 'installing' | 'done'

export interface SkillImportFetchResult {
  sessionId: string
  sourceLabel: string
  sourceType: string
  skills: DiscoveredSkill[]
}

export interface SkillImportResult {
  imported: number
  errors: Array<{ dir: string, error: string }>
}

export interface SkillImportDialogViewState {
  step: SkillImportDialogStep
  sourceInput: string
  fetchResult: SkillImportFetchResult | null
  selected: Set<string>
  importResult: SkillImportResult | null
  fetchError: string | null
}
