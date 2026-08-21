import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts'

import { cn } from '../cn'

export interface GaugeProps {
  /** Current value in the same unit as `max`. */
  value: number
  max?: number
  /** Rendered under the percent; defaults to `label`. */
  caption?: string
  label?: string
  size?: number
  className?: string
}

/** Percent gauge: a single recharts radial arc with a quiet center readout. */
export function Gauge({ value, max = 100, caption, label, size = 128, className }: GaugeProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const data = [{ name: 'value', value: ratio * 100 }]

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={data}
            innerRadius="78%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            barSize={10}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <RadialBar
              dataKey="value"
              cornerRadius={5}
              fill="var(--viz-blue)"
              background={{ fill: 'color-mix(in srgb, var(--foreground) 6%, transparent)' }}
              isAnimationActive={false}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[17px] font-medium tabular-nums text-[var(--foreground)]">
            {Math.round(ratio * 100)}
%
          </span>
        </div>
      </div>
      {(caption ?? label)
        ? (
            <span className="text-[11px] text-[var(--muted-foreground)]">{caption ?? label}</span>
          )
        : null}
    </div>
  )
}
