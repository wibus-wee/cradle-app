import { TrendingDownLine, TrendingUpLine } from '@mingcute/react'

import { cn } from '../cn'

export interface DeltaBadgeProps {
  direction: 'up' | 'down' | 'flat'
  /** Pre-formatted magnitude, e.g. `12.4%` or `+8`. */
  label: string
  className?: string
}

/** Quiet trend indicator: icon + tabular magnitude. Flat renders without an icon. */
export function DeltaBadge({ direction, label, className }: DeltaBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-medium tabular-nums',
        {
          'text-[var(--success)]': direction === 'up',
          'text-[var(--error)]': direction === 'down',
          'text-[var(--muted-foreground)]': direction === 'flat',
        },
        className,
      )}
    >
      {direction === 'up'
        ? <TrendingUpLine className="size-3" />
        : direction === 'down'
          ? <TrendingDownLine className="size-3" />
          : null}
      {label}
    </span>
  )
}
