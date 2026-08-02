import { cn } from '../cn'

export interface MetricItem {
  label: string
  value: string
  meta?: string
}

export interface MetricGridProps {
  items: MetricItem[]
  className?: string
}

export function MetricGrid({ items, className }: MetricGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-y-2 border-b border-border py-3 md:grid-cols-4 md:divide-x md:divide-border',
        className,
      )}
      aria-label="Metrics"
    >
      {items.map(item => (
        <MetricCell key={`${item.label}:${item.value}`} {...item} />
      ))}
    </div>
  )
}

export function MetricCell({ label, value, meta }: MetricItem) {
  return (
    <div className="min-w-0 md:px-3 md:first:pl-0 md:last:pr-0">
      <div className="text-[11px] text-text-tertiary">{label}</div>
      <div className="mt-0.5 truncate text-[14px] font-medium tabular-nums text-foreground">
        {value}
      </div>
      {meta
        ? (
          <div className="mt-px truncate text-[11px] tabular-nums text-text-secondary">
            {meta}
          </div>
        )
        : null}
    </div>
  )
}
