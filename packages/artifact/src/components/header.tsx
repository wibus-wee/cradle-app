import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface HeaderProps {
  eyebrow?: string
  title: string
  summary?: string
  meta?: ReactNode
  className?: string
}

export function Header({ eyebrow, title, summary, meta, className }: HeaderProps) {
  return (
    <header className={cn('border-b border-[var(--color-border-content)] pb-3', className)}>
      {(eyebrow || meta)
        ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
            {eyebrow ? <span>{eyebrow}</span> : null}
            {eyebrow && meta
              ? <span className="size-1 rounded-full bg-[var(--color-border-content)]" aria-hidden="true" />
              : null}
            {meta}
          </div>
        )
        : null}
      <div className={cn('flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1', eyebrow || meta ? 'mt-1' : undefined)}>
        <h1 className="min-w-0 text-balance text-[17px] font-semibold leading-6 text-[var(--text-primary)]">
          {title}
        </h1>
      </div>
      {summary
        ? (
          <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[var(--text-secondary)]">
            {summary}
          </p>
        )
        : null}
    </header>
  )
}
