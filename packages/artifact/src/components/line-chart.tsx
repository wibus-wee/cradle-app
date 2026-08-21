import { Area, AreaChart as RechartsAreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { cn } from '../cn'
import { ChartTooltip } from './chart-tooltip'

export interface LineChartPoint {
  label: string
  value: number
}

export interface LineChartProps {
  points: LineChartPoint[]
  height?: number
  /** Format tooltip values; defaults to `en-US` locale. */
  formatValue?: (value: number) => string
  className?: string
}

/**
 * Time-series area chart following the usage dashboard conventions:
 * hairline horizontal grid, dimmed ticks, soft area fill under the line.
 */
export function LineChart({ points, height = 160, formatValue, className }: LineChartProps) {
  const data = points.map(point => ({ label: point.label, value: point.value }))

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fillOpacity: 0.55 }}
          />
          <YAxis hide domain={[0, 'dataMax']} />
          <Tooltip cursor={{ stroke: 'var(--border)' }} content={<ChartTooltip formatValue={formatValue} />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--viz-blue)"
            strokeWidth={1.5}
            fill="var(--viz-blue)"
            fillOpacity={0.08}
            strokeLinecap="round"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  )
}
