import { InboxLine } from '@mingcute/react'
import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface EmptyStateProps {
  message: string
  hint?: string
  icon?: ReactNode
  className?: string
}

/** Quiet placeholder for empty collections. */
export function EmptyState({ message, hint, icon, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-1 px-4 py-8 text-center', className)}>
      <span className="mb-1 flex size-8 items-center justify-center text-[var(--text-dim)]">
        {icon ?? <InboxLine className="size-5" />}
      </span>
      <p className="text-xs text-[var(--muted-foreground)]">{message}</p>
      {hint
        ? <p className="text-[11px] text-[var(--text-dim)]">{hint}</p>
        : null}
    </div>
  )
}
