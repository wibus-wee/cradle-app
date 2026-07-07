// "When are you most active" section. The day-of-week chart is computed for
// real from the daily series (every usage row already carries a date, so the
// weekday split needs no new backend work). The hour-of-day chart is MOCK —
// see usage-mock-data.ts for exactly which backend endpoint would replace it.
import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, Cell, XAxis } from 'recharts'

import { Badge } from '~/components/ui/badge'
import type { ChartConfig } from '~/components/ui/chart'
import { ChartContainer, ChartTooltip } from '~/components/ui/chart'
import { cn } from '~/lib/cn'
import { formatPercentFromRatio, formatTokenCount } from '~/lib/number-format'

import type { ModelTokenShare } from './usage-insights'
import { modelBreakdownByWeekday, weekdayBreakdown, weekdayLabel } from './usage-insights'
import { mockHourOfDayDistribution } from './usage-mock-data'
import { ModelShareRows, TOOLTIP_CARD_CLASS } from './usage-model-tooltip'
import type { DailyUsage, DailyUsageByModel, UsageSummary } from './use-usage-overview'

interface UsagePatternsProps {
  daily: DailyUsage[]
  dailyByModel: DailyUsageByModel[]
  summary: UsageSummary
}

const WEEKDAY_CHART_CONFIG = { tokens: { label: 'Tokens', color: '#3b82f6' } } satisfies ChartConfig
// Muted neutral (not a second hue) — the "Preview" badge already flags this
// chart as estimated, so the color itself signals "quieter / less certain"
// rather than introducing a third competing accent color.
const HOUR_CHART_CONFIG = { tokens: { label: 'Tokens', color: 'var(--muted-foreground)' } } satisfies ChartConfig

export function UsagePatterns({ daily, dailyByModel, summary }: UsagePatternsProps) {
  const { t } = useTranslation('usage')

  const modelSharesByWeekday = useMemo(() => modelBreakdownByWeekday(dailyByModel), [dailyByModel])

  const weekdayData = useMemo(() => {
    const breakdown = weekdayBreakdown(daily)
    const maxTokens = Math.max(...breakdown.map(entry => entry.totalTokens), 1)
    return breakdown.map(entry => ({
      label: t(`patterns.weekdayShort.${weekdayLabel(entry.weekdayIndex)}`),
      weekdayIndex: entry.weekdayIndex,
      tokens: entry.totalTokens,
      isPeak: entry.totalTokens === maxTokens && entry.totalTokens > 0,
    }))
  }, [daily, t])

  const hourData = useMemo(() => {
    const buckets = mockHourOfDayDistribution(summary.totalTokens)
    const maxTokens = Math.max(...buckets.map(entry => entry.tokens), 1)
    return buckets.map(entry => ({
      label: String(entry.hour),
      hour: entry.hour,
      tokens: entry.tokens,
      isPeak: entry.tokens === maxTokens && entry.tokens > 0,
    }))
  }, [summary.totalTokens])

  if (weekdayData.every(entry => entry.tokens === 0)) {
    return null
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-sky-500" />
        <h2 className="text-sm font-semibold text-foreground">{t('patterns.title')}</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('patterns.description')}</p>

      <div className="mt-4 grid grid-cols-1 items-start gap-6 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">{t('patterns.byWeekday')}</p>
          <ChartContainer config={WEEKDAY_CHART_CONFIG} className="mt-2 aspect-auto h-[140px] w-full">
            <BarChart data={weekdayData} margin={{ top: 6, right: 4, left: 4, bottom: 0 }} barCategoryGap="24%">
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'currentColor', fillOpacity: 0.55 }} />
              <ChartTooltip
                cursor={{ fill: 'currentColor', fillOpacity: 0.04 }}
                allowEscapeViewBox={{ x: true, y: true }}
                wrapperStyle={{ zIndex: 50 }}
                content={({ active, payload }) => renderWeekdayTooltip(active, payload, modelSharesByWeekday, t)}
              />
              <Bar dataKey="tokens" radius={[3, 3, 0, 0]} maxBarSize={28}>
                {weekdayData.map(entry => (
                  <Cell key={entry.label} fill={entry.isPeak ? '#3b82f6' : 'color-mix(in oklch, #3b82f6 30%, transparent)'} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
          {/* Horizontal share bars beneath the vertical chart — easier to read
              exact "who's bigger by how much" than comparing bar heights, and
              they label each weekday with its % of total volume. */}
          <PatternProgressList
            data={weekdayData}
            labelClassName="w-6"
            peakClassName="bg-blue-500"
            restClassName="bg-blue-500/40"
          />
        </div>

        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">{t('patterns.byHour')}</p>
            <Badge variant="outline" className="h-4 px-1.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
              {t('patterns.previewBadge')}
            </Badge>
          </div>
          <ChartContainer config={HOUR_CHART_CONFIG} className="mt-2 aspect-auto h-[140px] w-full">
            <BarChart data={hourData} margin={{ top: 6, right: 4, left: 4, bottom: 0 }} barCategoryGap="18%">
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                interval={3}
                tick={{ fontSize: 10, fill: 'currentColor', fillOpacity: 0.55 }}
              />
              <ChartTooltip
                cursor={{ fill: 'currentColor', fillOpacity: 0.04 }}
                allowEscapeViewBox={{ x: true, y: true }}
                wrapperStyle={{ zIndex: 50 }}
                content={({ active, payload }) => renderPatternTooltip(active, payload)}
              />
              <Bar dataKey="tokens" radius={[3, 3, 0, 0]} maxBarSize={10}>
                {hourData.map(entry => (
                  <Cell key={entry.label} fill="currentColor" fillOpacity={entry.isPeak ? 0.45 : 0.18} className="text-foreground" />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
          {/* The 24-bar hour chart is too dense to compare by eye, so call out
              the busiest 3 hours as ranked share bars underneath. Neutral
              color (not blue) keeps it consistent with the mock chart above. */}
          <div className="mt-3">
            <p className="text-[10px] font-medium text-muted-foreground">{t('patterns.topHours')}</p>
            <PatternProgressList
              data={hourData}
              limit={3}
              labelClassName="w-10"
              peakClassName="bg-foreground/55"
              restClassName="bg-foreground/25"
              formatLabel={entry => `${entry.label.padStart(2, '0')}:00`}
            />
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/70">{t('patterns.previewHint')}</p>
        </div>
      </div>
    </div>
  )
}

function renderPatternTooltip(active: boolean | undefined, payload: ReadonlyArray<{ value?: unknown, payload?: { label: string } }> | undefined) {
  if (!active || !payload?.[0]) {
    return null
  }
  const tokens = typeof payload[0].value === 'number' ? payload[0].value : Number(payload[0].value ?? 0)
  const label = payload[0].payload?.label ?? ''
  const hourLabel = label ? `${label.padStart(2, '0')}:00` : ''
  return (
    <div className={cn(TOOLTIP_CARD_CLASS, 'min-w-40')}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-foreground">{hourLabel}</p>
        <p className="tabular-nums text-[11px] text-muted-foreground">{formatTokenCount(tokens)}</p>
      </div>
    </div>
  )
}

// The by-weekday chart is backed by real per-day rows, so — unlike the mock
// by-hour chart above — its tooltip can show a real "which model" line.
function renderWeekdayTooltip(
  active: boolean | undefined,
  payload: ReadonlyArray<{ value?: unknown, payload?: { weekdayIndex: number } }> | undefined,
  modelSharesByWeekday: Map<number, ModelTokenShare[]>,
  t: TFunction<'usage'>,
) {
  if (!active || !payload?.[0]) {
    return null
  }
  const tokens = typeof payload[0].value === 'number' ? payload[0].value : Number(payload[0].value ?? 0)
  const weekdayIndex = payload[0].payload?.weekdayIndex
  const weekdayName = weekdayIndex !== undefined ? t(`patterns.weekdayFull.${weekdayLabel(weekdayIndex)}`) : ''
  const shares = weekdayIndex !== undefined ? modelSharesByWeekday.get(weekdayIndex) ?? [] : []
  return (
    <div className={cn(TOOLTIP_CARD_CLASS, 'min-w-52')}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-foreground">{weekdayName}</p>
        <p className="tabular-nums text-[11px] text-muted-foreground">{formatTokenCount(tokens)}</p>
      </div>
      <ModelShareRows shares={shares} tone="default" />
    </div>
  )
}

interface PatternProgressEntry {
  label: string
  tokens: number
  isPeak: boolean
}

// Ranked horizontal share bars rendered beneath a pattern chart. Bar width is
// relative to the max entry (so the tallest always fills the track and the
// rest scale against it), while the trailing number is that entry's % of the
// grand total — two different reads ("how close to the peak" vs "share of
// all volume") from one compact row.
function PatternProgressList({
  data,
  formatLabel,
  limit,
  peakClassName,
  restClassName,
  labelClassName,
}: {
  data: PatternProgressEntry[]
  formatLabel?: (entry: PatternProgressEntry) => string
  limit?: number
  peakClassName: string
  restClassName: string
  labelClassName?: string
}) {
  const sorted = limit ? [...data].sort((a, b) => b.tokens - a.tokens).slice(0, limit) : data
  const max = Math.max(...sorted.map(entry => entry.tokens), 1)
  const total = data.reduce((sum, entry) => sum + entry.tokens, 0)
  return (
    <div className="mt-3 space-y-1.5">
      {sorted.map(entry => (
        <div key={entry.label} className="flex items-center gap-2.5">
          <span className={cn('shrink-0 text-[10px] tabular-nums text-muted-foreground', labelClassName)}>
            {formatLabel ? formatLabel(entry) : entry.label}
          </span>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/6">
            <div
              className={cn('size-full rounded-full transition-[width] duration-500', entry.isPeak ? peakClassName : restClassName)}
              style={{ width: `${(entry.tokens / max) * 100}%` }}
            />
          </div>
          <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
            {total > 0 ? formatPercentFromRatio(entry.tokens / total) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
