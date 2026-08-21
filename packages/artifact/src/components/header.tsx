import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface HeaderProps {
  /** Kicker line rendered before the title (e.g. a report category). */
  eyebrow?: string
  title: string
  summary?: string
  /** Trailing meta fragments joined by separators (dates, sources, timestamps). */
  meta?: ReactNode[]
  className?: string
}

export function Header({ eyebrow, title, summary, meta, className }: HeaderProps) {
  const fragments = [eyebrow, ...flatten(meta)].filter(Boolean) as ReactNode[]

  return (
    <header className={cn('flex flex-col gap-2', className)}>
      {fragments.length > 0
        ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
              {fragments.map((fragment, index) => (
                <span key={index} className="flex items-center gap-2">
                  {index > 0
                    ? <span aria-hidden="true" className="opacity-50">·</span>
                    : null}
                  {fragment}
                </span>
              ))}
            </div>
          )
        : null}
      <h1 className="text-balance text-[22px] font-semibold leading-tight tracking-[-0.01em] text-[var(--foreground)]">
        {title}
      </h1>
      {summary
        ? (
            <p className="max-w-[540px] text-pretty text-[13px] leading-relaxed text-[var(--muted-foreground)]">
              {summary}
            </p>
          )
        : null}
    </header>
  )
}

function flatten(nodes: ReactNode[] | undefined): ReactNode[] {
  return nodes ?? []
}
