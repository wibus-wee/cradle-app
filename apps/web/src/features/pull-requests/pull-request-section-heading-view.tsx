import type { ReactNode } from 'react'

export interface PullRequestSectionHeadingViewProps {
  children: ReactNode
}

export function PullRequestSectionHeadingView({
  children,
}: PullRequestSectionHeadingViewProps) {
  return (
    <h2 className="mb-2 text-[13px] font-semibold text-foreground/80">
      {children}
    </h2>
  )
}
