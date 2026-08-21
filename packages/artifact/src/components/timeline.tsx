import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface TimelineItem {
  id?: string
  title: string
  description?: string
  meta?: ReactNode
  tone?: 'info' | 'success' | 'warning' | 'danger'
}

export interface TimelineProps {
  items: TimelineItem[]
  className?: string
}

const TONE_RAIL: Record<NonNullable<TimelineItem['tone']>, string> = {
  info: 'bg-[var(--info)]',
  success: 'bg-[var(--success)]',
  warning: 'bg-[var(--warning)]',
  danger: 'bg-[var(--error)]',
}

/** Vertical event stream: tone ticks on a rail, quiet rows between. */
export function Timeline({ items, className }: TimelineProps) {
  return (
    <ol className={cn('flex flex-col', className)}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <li
            key={item.id ?? `${item.title}:${index}`}
            className="grid min-h-11 grid-cols-[16px_minmax(0,1fr)_auto] gap-2.5"
          >
            <div className="flex flex-col items-center" aria-hidden="true">
              <span
                className={cn(
                  'mt-[7px] size-2 shrink-0 rounded-full',
                  item.tone ? TONE_RAIL[item.tone] : 'bg-[var(--text-dim)]',
                )}
              />
              {!isLast ? <span className="w-px flex-1 bg-[var(--border)]" /> : null}
            </div>
            <div className="min-w-0 pb-3">
              <div className="truncate text-[13px] font-medium text-[var(--foreground)]">{item.title}</div>
              {item.description
                ? (
                    <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                      {item.description}
                    </div>
                  )
                : null}
            </div>
            {item.meta != null
              ? (
                  <div className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
                    {item.meta}
                  </div>
                )
              : null}
          </li>
        )
      })}
    </ol>
  )
}
