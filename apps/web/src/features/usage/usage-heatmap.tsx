import { useTranslation } from 'react-i18next'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { formatTokenCount } from '~/lib/number-format'

import { toDateKey } from './usage-date'
import { mostActiveWeekday, weekdayLabel } from './usage-insights'

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
const DAY_LABELS = [
  { key: 'sun', label: '' },
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: '' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: '' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: '' },
]
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface HeatmapCell {
  date: string
  tokens: number
  usage: DailyUsage | null
  future: boolean
}

function buildGrid(data: DailyUsage[]): {
  weeks: HeatmapCell[][]
  monthLabels: Array<{ label: string, weekIndex: number }>
  maxTokens: number
} {
  const lookup = new Map(data.map(d => [d.date, d]))

  const today = new Date()
  const todayDay = today.getDay()
  const start = new Date(today)
  start.setDate(start.getDate() - (WEEKS - 1) * 7 - todayDay)

  const weeks: HeatmapCell[][] = []
  const monthStarts = new Map<number, number>()
  let maxTokens = 0

  for (let w = 0; w < WEEKS; w++) {
    const week: HeatmapCell[] = []
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(start)
      cellDate.setDate(cellDate.getDate() + w * 7 + d)
      const dateStr = toDateKey(cellDate)

      if (cellDate > today) {
        week.push({ date: dateStr, tokens: 0, usage: null, future: true })
        continue
      }

      const usage = lookup.get(dateStr) ?? null
      const tokens = usage?.totalTokens ?? 0
      if (tokens > maxTokens) { maxTokens = tokens }

      week.push({ date: dateStr, tokens, usage, future: false })

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

// Blue intensity scale (matches the "tokens = blue" convention used across
// the rest of the redesigned dashboard) instead of the previous grayscale.
function cellColor(intensity: number): string {
  if (intensity === 0) { return 'var(--color-muted-foreground)' }
  const l = 0.82 - intensity * 0.32
  const c = 0.06 + intensity * 0.16
  return `oklch(${l} ${c} 255)`
}

function UsageHeatmapInner({ data }: UsageHeatmapProps) {
  const { t } = useTranslation('usage')
  const { weeks, monthLabels, maxTokens } = buildGrid(data)
  const topWeekday = mostActiveWeekday(data)

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
            {DAY_LABELS.map(({ key, label }) => (
              <div
                key={key}
                className="flex items-center text-[10px] text-muted-foreground/40"
                style={{ height: CELL_SIZE }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Weeks */}
          <div className="flex" style={{ gap: CELL_GAP }}>
            {weeks.map(week => (
              <div key={week[0].date} className="flex flex-col" style={{ gap: CELL_GAP }}>
                {week.map((cell) => {
                  if (cell.future) {
                    return <div key={cell.date} style={{ width: CELL_SIZE, height: CELL_SIZE }} />
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
                          className="cursor-default transition-[opacity,transform] duration-150 hover:scale-110 hover:opacity-100 hover:ring-1 hover:ring-foreground/60"
                        />
                      </TooltipTrigger>
                      <TooltipContent data-testid="usage-heatmap-tooltip" side="bottom" className="flex-col gap-0">
                        <p className="font-medium" data-testid="usage-heatmap-tooltip-date">{cell.date}</p>
                        <p className="text-background/70 mt-0.5" data-testid="usage-heatmap-tooltip-metrics">
                          {cell.tokens > 0
                            ? t('heatmap.tooltipMetrics', { tokens: cell.tokens.toLocaleString(), turns: cell.usage?.count ?? 0 })
                            : t('heatmap.tooltipNoUsage')}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {topWeekday && (
          <p className="mt-3 text-[11px] text-muted-foreground" style={{ marginLeft: leftPad }} data-testid="usage-heatmap-insight">
            {t('heatmap.mostActiveWeekday', {
              weekday: t(`patterns.weekdayFull.${weekdayLabel(topWeekday.weekdayIndex)}`),
              tokens: formatTokenCount(topWeekday.totalTokens),
              percent: Math.round(topWeekday.share * 100),
            })}
          </p>
        )}
      </div>
    </TooltipProvider>
  )
}

export const UsageHeatmap = UsageHeatmapInner
