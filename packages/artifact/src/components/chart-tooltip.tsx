import { cn } from '../cn'

export interface ChartTooltipProps {
  active?: boolean
  label?: string | number
  payload?: Array<{ value?: number | string }>
  /** Format the value; defaults to `en-US` locale. */
  formatValue?: (value: number) => string
  className?: string
}

/** Token-themed tooltip card shared by all artifact charts. */
export function ChartTooltip({ active, label, payload, formatValue = formatLocaleNumber, className }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null
  }

  const value = payload[0]?.value

  return (
    <div
      className={cn(
        'rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-[var(--shadow-sm)]',
        className,
      )}
    >
      {label != null
        ? <div className="mb-0.5 text-[11px] text-[var(--muted-foreground)]">{label}</div>
        : null}
      {typeof value === 'number'
        ? <div className="font-mono tabular-nums text-[var(--foreground)]">{formatValue(value)}</div>
        : null}
    </div>
  )
}

function formatLocaleNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return value.toLocaleString('en-US')
}
