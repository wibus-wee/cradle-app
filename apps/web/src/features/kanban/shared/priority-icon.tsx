import { cn } from '~/lib/cn'

type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent'

const priorityConfig: Record<Priority, { bars: number, color: string }> = {
  urgent: { bars: 4, color: '#ef4444' },
  high: { bars: 3, color: '#f97316' },
  medium: { bars: 2, color: '#eab308' },
  low: { bars: 1, color: '#3b82f6' },
  none: { bars: 0, color: '#6b7280' },
}

export function PriorityIcon({ priority, size = 16, className }: {
  priority: Priority
  size?: number
  className?: string
}) {
  const { bars, color } = priorityConfig[priority]

  if (bars === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className={cn('shrink-0', className)}>
        <line x1="4" y1="8" x2="12" y2="8" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    )
  }

  const barWidth = 2
  const gap = 1.5
  const totalWidth = bars * barWidth + (bars - 1) * gap
  const startX = (16 - totalWidth) / 2

  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={cn('shrink-0', className)}>
      {Array.from({ length: bars }).map((_, i) => {
        const barHeight = 4 + i * 2
        const x = startX + i * (barWidth + gap)
        const y = 12 - barHeight
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            rx={0.5}
            fill={color}
          />
        )
      })}
    </svg>
  )
}
