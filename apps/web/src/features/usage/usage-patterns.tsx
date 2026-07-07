// "When are you most active" section. The day-of-week chart is computed for
// real from the daily series (every usage row already carries a date, so the
// weekday split needs no new backend work). The hour-of-day chart is MOCK —
// see usage-mock-data.ts for exactly which backend endpoint would replace it.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, Cell, XAxis } from 'recharts'

import { Badge } from '~/components/ui/badge'
import type { ChartConfig } from '~/components/ui/chart'
import { ChartContainer, ChartTooltip } from '~/components/ui/chart'
import { formatTokenCount } from '~/lib/number-format'

import { weekdayBreakdown, weekdayLabel } from './usage-insights'
import { mockHourOfDayDistribution } from './usage-mock-data'
import type { DailyUsage, UsageSummary } from './use-usage-overview'

interface UsagePatternsProps {
  daily: DailyUsage[]
  summary: UsageSummary
}

const WEEKDAY_CHART_CONFIG = { tokens: { label: 'Tokens', color: '#3b82f6' } } satisfies ChartConfig
// Muted neutral (not a second hue) — the "Preview" badge already flags this
// chart as estimated, so the color itself signals "quieter / less certain"
// rather than introducing a third competing accent color.
const HOUR_CHART_CONFIG = { tokens: { label: 'Tokens', color: 'var(--muted-foreground)' } } satisfies ChartConfig

export function UsagePatterns({ daily, summary }: UsagePatternsProps) {
  const { t } = useTranslation('usage')

  const weekdayData = useMemo(() => {
    const breakdown = weekdayBreakdown(daily)
    const maxTokens = Math.max(...breakdown.map(entry => entry.totalTokens), 1)
    return breakdown.map(entry => ({
      label: t(`patterns.weekdayShort.${weekdayLabel(entry.weekdayIndex)}`),
      tokens: entry.totalTokens,
      isPeak: entry.totalTokens === maxTokens && entry.totalTokens > 0,
    }))
  }, [daily, t])

  const hourData = useMemo(() => {
    const buckets = mockHourOfDayDistribution(summary.totalTokens)
    const maxTokens = Math.max(...buckets.map(entry => entry.tokens), 1)
    return buckets.map(entry => ({
      label: String(entry.hour),
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

      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">{t('patterns.byWeekday')}</p>
          <ChartContainer config={WEEKDAY_CHART_CONFIG} className="mt-2 aspect-auto h-[140px] w-full">
            <BarChart data={weekdayData} margin={{ top: 6, right: 4, left: 4, bottom: 0 }} barCategoryGap="24%">
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'currentColor', fillOpacity: 0.55 }} />
              <ChartTooltip
                cursor={{ fill: 'currentColor', fillOpacity: 0.04 }}
                content={({ active, payload }) => renderPatternTooltip(active, payload)}
              />
              <Bar dataKey="tokens" radius={[3, 3, 0, 0]} maxBarSize={28}>
                {weekdayData.map(entry => (
                  <Cell key={entry.label} fill={entry.isPeak ? '#3b82f6' : 'color-mix(in oklch, #3b82f6 30%, transparent)'} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
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
                content={({ active, payload }) => renderPatternTooltip(active, payload)}
              />
              <Bar dataKey="tokens" radius={[3, 3, 0, 0]} maxBarSize={10}>
                {hourData.map(entry => (
                  <Cell key={entry.label} fill="currentColor" fillOpacity={entry.isPeak ? 0.45 : 0.18} className="text-foreground" />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
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
  return (
    <div className="rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="tabular-nums font-medium text-foreground">{formatTokenCount(tokens)}</p>
    </div>
  )
}
