// Hero trend chart — replaces the old hand-rolled SVG sparklines with a real
// interactive recharts area chart (crosshair tooltip, gradient fills, a
// tokens/cost toggle), following the same ChartContainer pattern already
// used in features/agent-management/codex-account-diagnostics-panel.tsx.
import { format, parseISO } from 'date-fns'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'

import type { ChartConfig } from '~/components/ui/chart'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '~/components/ui/chart'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { formatTokenCount, formatUsd } from '~/lib/number-format'

import { denseCostSeries, denseTokenSeries } from './usage-insights'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'
import type { DailyCost, DailyUsage } from './use-usage-overview'

type TrendMetric = 'tokens' | 'cost'

interface UsageTrendChartProps {
  daily: DailyUsage[]
  dailyCost: DailyCost[]
  range: UsageRangeKey
  hasCost: boolean
}

// Prompt/completion are two shades of the *same* hue (not blue+violet) so
// the split reads as "one metric, two parts" rather than two unrelated
// series — matches the hero cards' blue = volume convention.
const TOKENS_CHART_CONFIG = {
  promptTokens: { label: 'Prompt', color: '#3b82f6' },
  completionTokens: { label: 'Completion', color: '#93c5fd' },
} satisfies ChartConfig

const COST_CHART_CONFIG = {
  costUsd: { label: 'Cost', color: '#10b981' },
} satisfies ChartConfig

export function UsageTrendChart({ daily, dailyCost, range, hasCost }: UsageTrendChartProps) {
  const { t } = useTranslation('usage')
  const [metric, setMetric] = useState<TrendMetric>('tokens')
  const days = rangeDays(range)
  const activeMetric = hasCost ? metric : 'tokens'

  const tokenData = useMemo(() => denseTokenSeries(daily, days), [daily, days])
  const costData = useMemo(() => denseCostSeries(dailyCost, days), [dailyCost, days])

  const tickFormatter = (dateKey: string) => format(parseISO(dateKey), days > 90 ? 'MMM' : 'MMM d')

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-blue-500" />
            <h2 className="text-sm font-semibold text-foreground">{t('trend.title')}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('trend.description')}</p>
        </div>
        {hasCost && (
          <ToggleGroup
            type="single"
            value={activeMetric}
            onValueChange={(value) => {
              if (value === 'tokens' || value === 'cost') {
                setMetric(value)
              }
            }}
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-px rounded-md"
          >
            <ToggleGroupItem value="tokens" className="h-7 px-2.5 text-xs">{t('trend.toggleTokens')}</ToggleGroupItem>
            <ToggleGroupItem value="cost" className="h-7 px-2.5 text-xs">{t('trend.toggleCost')}</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      <div className="mt-4">
        {activeMetric === 'tokens'
          ? (
            <ChartContainer config={TOKENS_CHART_CONFIG} className="aspect-auto h-[220px] w-full">
              <AreaChart data={tokenData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="usage-trend-prompt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="usage-trend-completion" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#93c5fd" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#93c5fd" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.06} strokeDasharray="2 4" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={36}
                  tick={{ fontSize: 10, fill: 'currentColor', fillOpacity: 0.55 }}
                  tickFormatter={tickFormatter}
                />
                <ChartTooltip
                  cursor={{ stroke: 'currentColor', strokeOpacity: 0.15 }}
                  content={(
                    <ChartTooltipContent
                      labelFormatter={value => format(parseISO(String(value)), 'PP')}
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: name === 'promptTokens' ? '#3b82f6' : '#93c5fd' }}
                            />
                            {name === 'promptTokens' ? t('trend.prompt') : t('trend.completion')}
                          </span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {formatTokenCount(typeof value === 'number' ? value : Number(value ?? 0))}
                          </span>
                        </div>
                      )}
                    />
                  )}
                />
                <Area type="monotone" dataKey="promptTokens" stackId="tokens" stroke="#3b82f6" strokeWidth={1.5} fill="url(#usage-trend-prompt)" />
                <Area type="monotone" dataKey="completionTokens" stackId="tokens" stroke="#93c5fd" strokeWidth={1.5} fill="url(#usage-trend-completion)" />
              </AreaChart>
            </ChartContainer>
          )
          : (
            <ChartContainer config={COST_CHART_CONFIG} className="aspect-auto h-[220px] w-full">
              <AreaChart data={costData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="usage-trend-cost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.06} strokeDasharray="2 4" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={36}
                  tick={{ fontSize: 10, fill: 'currentColor', fillOpacity: 0.55 }}
                  tickFormatter={tickFormatter}
                />
                <ChartTooltip
                  cursor={{ stroke: 'currentColor', strokeOpacity: 0.15 }}
                  content={(
                    <ChartTooltipContent
                      hideLabel={false}
                      labelFormatter={value => format(parseISO(String(value)), 'PP')}
                      formatter={value => (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            {t('trend.cost')}
                          </span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {formatUsd(typeof value === 'number' ? value : Number(value ?? 0))}
                          </span>
                        </div>
                      )}
                    />
                  )}
                />
                <Area type="monotone" dataKey="costUsd" stroke="#10b981" strokeWidth={1.5} fill="url(#usage-trend-cost)" />
              </AreaChart>
            </ChartContainer>
          )}
      </div>
    </div>
  )
}
