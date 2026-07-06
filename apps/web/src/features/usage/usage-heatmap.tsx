import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'

interface DailyUsage {
  date: string
  totalTokens: number
  promptTokens: number
  completionTokens: number
  count: number
}

interface UsageHeatmapProps {
  data: DailyUsage[]
  days?: number
}

const CELL_SIZE = 13
const CELL_GAP = 3
const CELL_RADIUS = 3.5
const WEEKS = 53
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildGrid(data: DailyUsage[]): {
  weeks: Array<Array<{ date: string, tokens: number, usage: DailyUsage | null } | null>>
  monthLabels: Array<{ label: string, weekIndex: number }>
  maxTokens: number
} {
  const lookup = new Map(data.map(d => [d.date, d]))

  const today = new Date()
  const todayDay = today.getDay()
  const start = new Date(today)
  start.setDate(start.getDate() - (WEEKS - 1) * 7 - todayDay)

  const weeks: Array<Array<{ date: string, tokens: number, usage: DailyUsage | null } | null>> = []
  const monthStarts = new Map<number, number>()
  let maxTokens = 0

  for (let w = 0; w < WEEKS; w++) {
    const week: Array<{ date: string, tokens: number, usage: DailyUsage | null } | null> = []
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(start)
      cellDate.setDate(cellDate.getDate() + w * 7 + d)

      if (cellDate > today) {
        week.push(null)
        continue
      }

      const dateStr = getDateString(cellDate)
      const usage = lookup.get(dateStr) ?? null
      const tokens = usage?.totalTokens ?? 0
      if (tokens > maxTokens) { maxTokens = tokens }

      week.push({ date: dateStr, tokens, usage })

      const month = cellDate.getMonth()
      if (!monthStarts.has(month) || w < monthStarts.get(month)!) {
        monthStarts.set(month, w)
      }
    }
    weeks.push(week)
  }

  const monthLabels = Array.from(monthStarts.entries())
    .sort(([, a], [, b]) => a - b)
    .map(([month, weekIndex]) => ({ label: MONTH_NAMES[month], weekIndex }))

  return { weeks, monthLabels, maxTokens }
}

function cellColor(intensity: number): string {
  if (intensity === 0) { return 'var(--color-muted-foreground)' }
  const l = 0.75 - intensity * 0.25
  const c = 0.05 + intensity * 0.15
  return `oklch(${l} ${c} 160)`
}

function UsageHeatmapInner({ data }: UsageHeatmapProps) {
  const { weeks, monthLabels, maxTokens } = buildGrid(data)

  const cellStep = CELL_SIZE + CELL_GAP
  const leftPad = 32
  const topPad = 20

  return (
    <TooltipProvider delayDuration={0}>
      <div data-testid="usage-heatmap" className="mx-auto w-fit">
        {/* Month labels row */}
        <div className="relative mb-0.5" style={{ height: topPad, marginLeft: leftPad }}>
          {monthLabels.map(({ label, weekIndex }) => (
            <span
              key={`${label}-${weekIndex}`}
              className="absolute text-[10px] text-muted-foreground/50"
              style={{ left: weekIndex * cellStep }}
            >
              {label}
            </span>
          ))}
        </div>

        {/* Grid + day labels */}
        <div className="flex gap-0">
          {/* Day labels column */}
          <div className="flex flex-col" style={{ width: leftPad, gap: CELL_GAP }}>
            {DAY_LABELS.map((label, i) => (
              <div
                key={i}
                className="flex items-center text-[10px] text-muted-foreground/40"
                style={{ height: CELL_SIZE }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Weeks */}
          <div className="flex" style={{ gap: CELL_GAP }}>
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col" style={{ gap: CELL_GAP }}>
                {week.map((cell, di) => {
                  if (!cell) {
                    return <div key={di} style={{ width: CELL_SIZE, height: CELL_SIZE }} />
                  }
                  const intensity = maxTokens > 0 ? cell.tokens / maxTokens : 0
                  return (
                    <Tooltip key={cell.date}>
                      <TooltipTrigger asChild>
                        <div
                          data-testid="usage-heatmap-cell"
                          data-date={cell.date}
                          data-has-usage={cell.tokens > 0 ? 'true' : 'false'}
                          style={{
                            width: CELL_SIZE,
                            height: CELL_SIZE,
                            borderRadius: CELL_RADIUS,
                            backgroundColor: cellColor(intensity),
                            opacity: intensity === 0 ? 0.08 : 1,
                          }}
                          className="transition-opacity duration-150 hover:ring-1 hover:ring-foreground hover:opacity-100 cursor-default"
                        />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="flex-col gap-0">
                        <p className="font-medium" data-testid="usage-heatmap-tooltip-date">{cell.date}</p>
                        <p className="text-background/70 mt-0.5" data-testid="usage-heatmap-tooltip-metrics">
                          {cell.tokens > 0
                            ? `${cell.tokens.toLocaleString()} tokens`
                            : 'No usage'}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

export const UsageHeatmap = UsageHeatmapInner
