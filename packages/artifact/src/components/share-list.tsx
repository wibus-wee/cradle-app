import { cn } from '../cn'

export interface ShareItem {
  label: string
  value: number
}

export interface ShareListProps {
  items: ShareItem[]
  /** Format the absolute value column; defaults to `en-US` locale. */
  formatValue?: (value: number) => string
  className?: string
}

/**
 * Share-of-total rows: label + proportional track + value + percent.
 * The largest item renders at full intensity; the rest are dimmed.
 */
export function ShareList({ items, formatValue = formatLocaleNumber, className }: ShareListProps) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0)
  const max = Math.max(0, ...items.map(item => item.value))

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {items.map((item) => {
        const share = total > 0 ? Math.max(0, item.value) / total : 0
        const width = max > 0 ? (Math.max(0, item.value) / max) * 100 : 0
        const isTop = item.value === max && max > 0

        return (
          <div
            key={item.label}
            className="grid min-h-6 grid-cols-[96px_minmax(0,1fr)_56px_40px] items-center gap-3"
          >
            <span className="truncate text-xs text-[var(--foreground)]">{item.label}</span>
            <div
              className={cn(
                'relative h-1.5 overflow-hidden rounded-full',
                'bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]',
              )}
            >
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full bg-[var(--viz-blue)] transition-[width] duration-500 ease-[var(--ease-standard)]',
                  isTop ? 'opacity-100' : 'opacity-40',
                )}
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="text-right font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
              {formatValue(item.value)}
            </span>
            <span className="text-right font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
              {Math.round(share * 100)}
%
            </span>
          </div>
        )
      })}
    </div>
  )
}

function formatLocaleNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return value.toLocaleString('en-US')
}
