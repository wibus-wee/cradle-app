import { AlertLine, CheckCircleLine, CloseCircleLine, InformationLine } from '@mingcute/react'
import type { ReactNode } from 'react'

import { cn } from '../cn'
import { EmptyState } from './empty-state'

export interface ListItem {
  id?: string
  title: string
  description?: string
  meta?: ReactNode
  /** Status icon on the leading edge; omit for a plain row. */
  tone?: 'info' | 'success' | 'warning' | 'danger'
}

export interface ListProps {
  items: ListItem[]
  className?: string
  emptyMessage?: string
}

const TONE_ICON: Record<NonNullable<ListItem['tone']>, ReactNode> = {
  info: <InformationLine className="size-4 text-[var(--info)]" />,
  success: <CheckCircleLine className="size-4 text-[var(--success)]" />,
  warning: <AlertLine className="size-4 text-[var(--warning)]" />,
  danger: <CloseCircleLine className="size-4 text-[var(--error)]" />,
}

function toneIcon(tone: ListItem['tone']): ReactNode {
  return tone != null ? TONE_ICON[tone] ?? null : null
}

/** Quiet rows separated by space — status is carried by line icons, not dots. */
export function List({ items, className, emptyMessage = 'No items' }: ListProps) {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} className={cn('py-4', className)} />
  }

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {items.map((item, index) => (
        <div
          key={item.id ?? `${item.title}:${index}`}
          className={cn(
            'grid min-h-10 items-center gap-2.5 rounded-md px-2.5 py-1.5',
            'transition-colors duration-[var(--duration-quick)] ease-[var(--ease-standard)] hover:bg-[var(--muted)]',
            item.tone ? 'grid-cols-[20px_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]',
          )}
        >
          {toneIcon(item.tone)
            ? (
                <span className="flex items-center justify-center" aria-hidden="true">
                  {toneIcon(item.tone)}
                </span>
              )
            : null}
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-[var(--foreground)]">{item.title}</div>
            {item.description
              ? (
                  <div className="truncate text-[11px] text-[var(--text-tertiary)]">{item.description}</div>
                )
              : null}
          </div>
          {item.meta != null
            ? (
                <div className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
                  {item.meta}
                </div>
              )
            : null}
        </div>
      ))}
    </div>
  )
}
