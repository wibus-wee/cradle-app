import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface SectionProps {
  title?: string
  description?: string
  children?: ReactNode
  className?: string
  /** When true, omit the bottom border (useful for the last section). */
  flush?: boolean
}

export function Section({ title, description, children, className, flush }: SectionProps) {
  return (
    <section className={cn(flush ? 'py-3' : 'border-b border-[var(--color-border-content)] py-3', className)}>
      {(title || description)
        ? (
          <div className="mb-2">
            {title
              ? <h2 className="text-[13px] font-medium text-[var(--text-primary)]">{title}</h2>
              : null}
            {description
              ? <p className="mt-0.5 text-[12px] leading-4 text-[var(--text-secondary)]">{description}</p>
              : null}
          </div>
        )
        : null}
      {children}
    </section>
  )
}
