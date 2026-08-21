import { DownSmallLine } from '@mingcute/react'
import type { ReactNode } from 'react'
import { useId, useState } from 'react'

import { cn } from '../cn'

export interface CollapsibleProps {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}

/** Expandable block with a rotating chevron; content stays mounted. */
export function Collapsible({ title, children, defaultOpen = false, className }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <div className={cn('rounded-[var(--radius-lg)] shadow-[inset_0_0_0_1px_var(--border)]', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(value => !value)}
        className={cn(
          'flex min-h-10 w-full items-center justify-between gap-3 px-3 text-left text-[13px] font-medium text-[var(--foreground)]',
          'transition-colors duration-[var(--duration-quick)] ease-[var(--ease-standard)] hover:bg-[var(--muted)]',
          'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--viz-blue)] rounded-[var(--radius-lg)]',
          open && 'rounded-b-none',
        )}
      >
        {title}
        <DownSmallLine
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-[var(--muted-foreground)] transition-transform duration-[var(--duration-quick)] ease-[var(--ease-standard)]',
            open ? 'rotate-180' : 'rotate-0',
          )}
        />
      </button>
      {open
        ? (
            <div id={contentId} className="border-t border-[var(--border)] px-3 py-2.5">
              {children}
            </div>
          )
        : null}
    </div>
  )
}
