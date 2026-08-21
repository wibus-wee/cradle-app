import { Area, AreaChart } from 'recharts'

import { cn } from '../cn'

export interface SparklineProps {
  /** Ordered values; only the shape matters, not the scale labels. */
  data: number[]
  width?: number
  height?: number
  className?: string
}

/**
 * Tiny trend line for metric footers. Recharts AreaChart with all chrome
 * stripped — no axes, grid, tooltip, or animation.
 */
export function Sparkline({ data, width = 112, height = 26, className }: SparklineProps) {
  if (data.length < 2) {
    return null
  }

  const points = data.map((value, index) => ({ index, value }))
  const lastIndex = points.length - 1

  return (
    <div className={cn('shrink-0', className)} aria-hidden="true">
      <AreaChart
        width={width}
        height={height}
        data={points}
        margin={{ top: 2, right: 4, bottom: 2, left: 4 }}
      >
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--viz-blue)"
          strokeWidth={1.5}
          fill="var(--viz-blue)"
          fillOpacity={0.08}
          strokeLinecap="round"
          isAnimationActive={false}
          activeDot={false}
          dot={(dotProps: { cx?: number, cy?: number, index?: number }) => (
            dotProps.index === lastIndex && dotProps.cx != null && dotProps.cy != null
              ? <circle key="end" cx={dotProps.cx} cy={dotProps.cy} r={2.5} fill="var(--viz-blue)" />
              : null
          )}
        />
      </AreaChart>
    </div>
  )
}
