import type { ReactNode } from 'react'

import type { StatusIconType } from './status-meta'

export interface PullRequestPropertyRowViewProps {
  icon: StatusIconType
  label: string
  children: ReactNode
}

export function PullRequestPropertyRowView({
  icon: Icon,
  label,
  children,
}: PullRequestPropertyRowViewProps) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
        <Icon className="size-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-foreground/85">
        {children}
      </dd>
    </div>
  )
}
