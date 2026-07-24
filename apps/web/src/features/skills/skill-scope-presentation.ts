import {
  GlobeLine as GlobeIcon,
  RobotLine as BotIcon,
  TreeLine as FolderTreeIcon,
} from '@mingcute/react'

import type { SkillScope } from './types'

export const skillScopeLabels: Record<SkillScope, string> = {
  builtin: 'Built-in',
  legacy: 'Standard',
  global: 'Global',
  repository: 'Workspace',
  workspace: 'Workspace',
  agent: 'Agent',
}

export const skillScopeIcons: Record<SkillScope, typeof BotIcon> = {
  builtin: BotIcon,
  legacy: GlobeIcon,
  global: GlobeIcon,
  repository: FolderTreeIcon,
  workspace: FolderTreeIcon,
  agent: BotIcon,
}

export const skillScopeAccentClasses: Record<SkillScope, string> = {
  builtin: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  legacy: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  global: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  repository: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  workspace: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  agent: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
}
