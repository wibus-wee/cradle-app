import { cn } from '../cn'

export interface ProgressProps {
  /** Current value in the same unit as `max`. */
  value: number
  max?: number
  label?: string
  /** Show the formatted percent on the trailing edge. */
  showValue?: boolean
  className?: string
}

/** Determinate goal bar: label + hairline track + percent. */
export function Progress({ value, max = 100, label, showValue = true, className }: ProgressProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || showValue)
        ? (
            <div className="flex items-baseline justify-between gap-3">
              {label
                ? <span className="truncate text-xs text-[var(--foreground)]">{label}</span>
                : <span />}
              {showValue
                ? (
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
                      {Math.round(ratio * 100)}
%
                    </span>
                  )
                : null}
            </div>
          )
        : null}
      <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]">
        <div
          className="h-full rounded-full bg-[var(--viz-blue)] transition-[width] duration-500 ease-[var(--ease-standard)]"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}
