import { cn } from '../cn'
import type { DeltaBadgeProps } from './delta-badge'
import { DeltaBadge } from './delta-badge'
import { Sparkline } from './sparkline'

export interface MetricItem {
  label: string
  /** Pre-formatted display value, e.g. `4.82M` or `91.7%`. */
  value: string
  delta?: DeltaBadgeProps
  /** Supporting caption rendered next to the delta (e.g. `vs last week`). */
  caption?: string
  /** Recent values rendered as a sparkline under the metric. */
  sparkline?: number[]
}

export interface MetricsProps {
  items: MetricItem[]
  className?: string
}

/**
 * Quiet KPI strip: big tabular numbers separated by hairlines, following the
 * usage dashboard hero pattern — no cards, no wells. Fixed column tracks keep
 * every item on one row on wide panels; values truncate instead of wrapping.
 */
export function Metrics({ items, className }: MetricsProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-6 sm:divide-x sm:divide-[var(--border)] md:grid-cols-3 lg:grid-cols-4',
        className,
      )}
      aria-label="Metrics"
    >
      {items.map(item => (
        <Metric key={`${item.label}:${item.value}`} {...item} />
      ))}
    </div>
  )
}

function Metric({ label, value, delta, caption, sparkline }: MetricItem) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <div className="text-[11px] font-medium text-[var(--muted-foreground)]">{label}</div>
      <div className="truncate text-[26px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-[var(--foreground)]">
        {value}
      </div>
      {(delta || caption)
        ? (
            <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--muted-foreground)]">
              {delta ? <DeltaBadge {...delta} /> : null}
              {caption ? <span className="truncate">{caption}</span> : null}
            </div>
          )
        : null}
      {sparkline && sparkline.length >= 2
        ? <Sparkline data={sparkline} className="mt-1" />
        : null}
    </div>
  )
}
