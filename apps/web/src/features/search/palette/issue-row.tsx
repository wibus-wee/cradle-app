import { DotCircleLine } from '@mingcute/react'

import { CommandItem } from '~/components/ui/command'

import type { IssueSearchHit } from './types'

export interface IssueRowProps {
  data: IssueSearchHit
  onSelect: (issueId: string) => void
}

export function IssueRow({ data: issue, onSelect }: IssueRowProps) {
  return (
    <CommandItem
      value={`issue-${issue.id}`}
      onSelect={() => onSelect(issue.id)}
      data-testid={`global-search-issue-result-${issue.title}`}
    >
      <DotCircleLine className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-[13px]">{issue.title}</span>
    </CommandItem>
  )
}
