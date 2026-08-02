import { cn } from '../cn'

export interface BarChartItem {
  label: string
  value: number
}

export interface BarChartProps {
  items: BarChartItem[]
  className?: string
  /** Max bar height in pixels. */
  height?: number
}

/**
 * Simple horizontal-comparison bar chart. Prefer SegmentedBar for share-of-total views.
 */
export function BarChart({ items, className, height = 120 }: BarChartProps) {
  const max = Math.max(0, ...items.map(item => item.value))

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-end gap-2" style={{ height }}>
        {items.map((item) => {
          const ratio = max > 0 ? item.value / max : 0
          return (
            <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] tabular-nums text-text-tertiary">
                {item.value.toLocaleString('en-US')}
              </span>
              <div
                className="w-full max-w-10 rounded-t-sm bg-blue-500/80"
                style={{ height: `${Math.max(4, ratio * (height - 28))}px` }}
                title={`${item.label}: ${item.value}`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-2">
        {items.map(item => (
          <div
            key={`label:${item.label}`}
            className="min-w-0 flex-1 truncate text-center text-[10px] text-text-tertiary"
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  )
}
