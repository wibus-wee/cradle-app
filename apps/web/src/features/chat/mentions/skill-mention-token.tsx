import { BookmarksLine as LibraryBig } from '@mingcute/react'

import { cn } from '~/lib/cn'

export const SKILL_MENTION_TOKEN_CLASS = 'inline-flex items-center gap-0.5 align-baseline text-[0.8125em] font-medium text-sky-600 dark:text-sky-400'

export function formatSkillMentionTokenLabel(name: string): string {
  return `$${name}`
}

export function SkillMentionToken({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <span className={cn(SKILL_MENTION_TOKEN_CLASS, className)}>
      <LibraryBig size={10} />
{' '}
{formatSkillMentionTokenLabel(name)}
    </span>
  )
}
