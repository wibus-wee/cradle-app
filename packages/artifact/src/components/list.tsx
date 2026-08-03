import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface ListItem {
  id?: string
  title: string
  description?: string
  meta?: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'danger'
}

export interface ListProps {
  items: ListItem[]
  className?: string
  emptyMessage?: string
}

const TONE_DOT: Record<NonNullable<ListItem['tone']>, string> = {
  default: 'bg-[var(--text-dim)]',
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  danger: 'bg-[var(--color-error)]',
}

export function List({ items, className, emptyMessage = 'No items' }: ListProps) {
  if (items.length === 0) {
    return (
      <div className={cn('px-1.5 py-3 text-[12px] text-[var(--text-tertiary)]', className)}>
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className={cn('divide-y divide-[var(--color-border-content)]', className)}>
      {items.map((item, index) => (
        <div
          key={item.id ?? `${item.title}:${index}`}
          className="grid min-h-10 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-md)] px-1.5 py-1.5 transition-colors duration-[var(--duration-quick)] ease-[var(--ease-standard)] hover:bg-[var(--color-fill)]"
        >
          <span
            className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[item.tone ?? 'default'])}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">{item.title}</div>
            {item.description
              ? (
                <div className="truncate text-[11px] text-[var(--text-tertiary)]">{item.description}</div>
              )
              : null}
          </div>
          {item.meta
            ? (
              <div className="shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)]">
                {item.meta}
              </div>
            )
            : null}
        </div>
      ))}
    </div>
  )
}
