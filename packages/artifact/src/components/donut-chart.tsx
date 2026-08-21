import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { cn } from '../cn'
import { chartColor } from '../theme'
import { ChartTooltip } from './chart-tooltip'

export interface DonutSegment {
  label: string
  value: number
}

export interface DonutChartProps {
  segments: DonutSegment[]
  /** Rendered in the donut hole; defaults to the formatted total. */
  centerLabel?: string
  size?: number
  /** Format tooltip and legend values; defaults to `en-US` locale. */
  formatValue?: (value: number) => string
  className?: string
}

/**
 * Share-of-total donut with a quiet legend (label + value + percent rows,
 * no color dots — segment order maps to legend order).
 */
export function DonutChart({
  segments,
  centerLabel,
  size = 148,
  formatValue = formatLocaleNumber,
  className,
}: DonutChartProps) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0)
  const data = segments.map(segment => ({ label: segment.label, value: segment.value }))

  return (
    <div className={cn('flex flex-wrap items-center gap-x-8 gap-y-4', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<ChartTooltip formatValue={formatValue} />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={2}
              cornerRadius={3}
              stroke="none"
              isAnimationActive={false}
            >
              {segments.map((segment, index) => (
                <Cell key={segment.label} fill={chartColor(index)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[15px] font-medium tabular-nums text-[var(--foreground)]">
            {centerLabel ?? formatValue(total)}
          </span>
        </div>
      </div>
      <div className="flex min-w-[180px] flex-1 flex-col gap-1">
        {segments.map((segment, index) => {
          const share = total > 0 ? Math.round((Math.max(0, segment.value) / total) * 100) : 0
          return (
            <div
              key={segment.label}
              className="grid min-h-7 grid-cols-[40px_minmax(0,1fr)_auto_40px] items-center gap-3 rounded-md px-2 text-xs transition-colors duration-[var(--duration-quick)] ease-[var(--ease-standard)] hover:bg-[var(--muted)]"
            >
              <span
                aria-hidden="true"
                className="h-1.5 rounded-full transition-opacity duration-[var(--duration-quick)] ease-[var(--ease-standard)] hover:opacity-100"
                style={{
                  backgroundColor: chartColor(index),
                  opacity: 0.85,
                  width: `${Math.max(8, share)}%`,
                  minWidth: '10px',
                  maxWidth: '40px',
                }}
              />
              <span className="min-w-0 truncate">{segment.label}</span>
              <span className="text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                {formatValue(segment.value)}
              </span>
              <span className="text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                {share}
%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatLocaleNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return value.toLocaleString('en-US')
}
