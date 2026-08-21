import { Bar, BarChart as RechartsBarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { cn } from '../cn'
import { ChartTooltip } from './chart-tooltip'

export interface BarChartItem {
  label: string
  value: number
}

export interface BarChartProps {
  items: BarChartItem[]
  height?: number
  /** Format tooltip values; defaults to `en-US` locale. */
  formatValue?: (value: number) => string
  className?: string
}

/**
 * Vertical comparison bars following the usage dashboard conventions:
 * rounded tops, max bar width, dimmed ticks, peak at full intensity.
 */
export function BarChart({ items, height = 150, formatValue, className }: BarChartProps) {
  const peakIndex = items.reduce((best, item, index) => (item.value > items[best]!.value ? index : best), 0)
  const data = items.map(item => ({ label: item.label, value: item.value }))

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={{ fontSize: 10, fillOpacity: 0.55 }}
          />
          <YAxis hide domain={[0, 'dataMax']} />
          <Tooltip cursor={false} content={<ChartTooltip formatValue={formatValue} />} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false}>
            {items.map((item, index) => (
              <Cell
                key={item.label}
                fill={
                  index === peakIndex
                    ? 'var(--viz-blue)'
                    : 'color-mix(in srgb, var(--viz-blue) 40%, transparent)'
                }
              />
            ))}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  )
}
