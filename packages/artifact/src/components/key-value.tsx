import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface KeyValueItem {
  label: string
  value: ReactNode
}

export interface KeyValueProps {
  items: KeyValueItem[]
  className?: string
}

/** Label/value rows separated by hairlines, for compact metadata summaries. */
export function KeyValue({ items, className }: KeyValueProps) {
  return (
    <dl className={cn('divide-y divide-[var(--border)]', className)}>
      {items.map(item => (
        <div key={item.label} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="shrink-0 text-xs text-[var(--muted-foreground)]">{item.label}</dt>
          <dd className="min-w-0 truncate text-right text-xs font-medium text-[var(--foreground)]">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
