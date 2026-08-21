import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface SectionProps {
  title?: string
  description?: string
  children?: ReactNode
  className?: string
}

/** Titled content block. Separation comes from the parent's spacing, not borders. */
export function Section({ title, description, children, className }: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-3.5', className)}>
      {(title || description)
        ? (
            <div>
              {title
                ? (
                    <h2 className="text-balance text-[15px] font-semibold leading-snug text-[var(--foreground)]">
                      {title}
                    </h2>
                  )
                : null}
              {description
                ? (
                    <p className="mt-0.5 max-w-[540px] text-pretty text-xs leading-relaxed text-[var(--muted-foreground)]">
                      {description}
                    </p>
                  )
                : null}
            </div>
          )
        : null}
      {children}
    </section>
  )
}
