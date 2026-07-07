// Tiny gradient-filled area sparkline used as a card background accent.
// Uses a normalized viewBox + `preserveAspectRatio="none"` so it stretches to
// fill its container without needing a ResizeObserver for such a decorative,
// low-stakes visual.
interface UsageMiniSparkProps {
  data: number[]
  color: string
  height?: number
  className?: string
}

const VIEWBOX_WIDTH = 100

export function UsageMiniSpark({ data, color, height = 32, className }: UsageMiniSparkProps) {
  if (data.length < 2) {
    return null
  }
  const max = Math.max(...data, 1)
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * VIEWBOX_WIDTH
    const y = height - (value / max) * (height - 3) - 1.5
    return `${x},${y}`
  })
  const gradientId = `usage-mini-spark-${color.replace(/[^a-z0-9]/gi, '')}`
  const lineD = `M${points.join(' L')}`
  const areaD = `${lineD} L${VIEWBOX_WIDTH},${height} L0,${height} Z`

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradientId})`} />
      <path d={lineD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
