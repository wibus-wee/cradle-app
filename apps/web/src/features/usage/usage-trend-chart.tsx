// Hero trend chart — replaces the old hand-rolled SVG sparklines with a real
// interactive recharts area chart (crosshair tooltip, gradient fills, a
// tokens/cost toggle), following the same ChartContainer pattern already
// used in features/agent-management/codex-account-diagnostics-panel.tsx.
import { format, parseISO } from 'date-fns'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'

import type { ChartConfig } from '~/components/ui/chart'
import { ChartContainer, ChartTooltip } from '~/components/ui/chart'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'
import { formatTokenCount, formatUsd } from '~/lib/number-format'

import type { ModelTokenShare } from './usage-insights'
import { denseCostSeries, denseTokenSeries, modelBreakdownByDate } from './usage-insights'
import { ModelShareRows, TOOLTIP_CARD_CLASS } from './usage-model-tooltip'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'
import type { DailyCost, DailyUsage, DailyUsageByModel } from './use-usage-overview'

type TrendMetric = 'tokens' | 'cost'

interface UsageTrendChartProps {
  daily: DailyUsage[]
  dailyCost: DailyCost[]
  dailyByModel: DailyUsageByModel[]
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

interface TrendTooltipPoint {
  date: string
}

interface TrendTooltipEntry {
  value?: unknown
  // recharts allows a dataKey accessor function too, so keep this loose — we
  // only ever compare it to a string literal, which is safe regardless.
  dataKey?: unknown
  payload?: TrendTooltipPoint
}

export function UsageTrendChart({ daily, dailyCost, dailyByModel, range, hasCost }: UsageTrendChartProps) {
  const { t } = useTranslation('usage')
  const [metric, setMetric] = useState<TrendMetric>('tokens')
  const days = rangeDays(range)
  const activeMetric = hasCost ? metric : 'tokens'

  const tokenData = useMemo(() => denseTokenSeries(daily, days), [daily, days])
  const costData = useMemo(() => denseCostSeries(dailyCost, days), [dailyCost, days])
  // Per-day model split for the tokens tooltip — the stacked area shows
  // prompt vs completion; this answers the follow-up "but which model was
  // that?" for whatever day is hovered.
  const modelSharesByDate = useMemo(() => modelBreakdownByDate(dailyByModel), [dailyByModel])

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
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ zIndex: 50 }}
                  content={({ active, payload }) => renderTokensTooltip(active, payload, modelSharesByDate, t)}
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
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ zIndex: 50 }}
                  content={({ active, payload }) => renderCostTooltip(active, payload, t)}
                />
                <Area type="monotone" dataKey="costUsd" stroke="#10b981" strokeWidth={1.5} fill="url(#usage-trend-cost)" />
              </AreaChart>
            </ChartContainer>
          )}
      </div>
    </div>
  )
}

// Tokens tooltip: the hovered day's prompt + completion totals, followed by
// a per-model breakdown with share bars — "what was this day made of?" in one
// hover. Models come from the daily-by-model series (top-N + "other").
function renderTokensTooltip(
  active: boolean | undefined,
  payload: ReadonlyArray<TrendTooltipEntry> | undefined,
  modelSharesByDate: Map<string, ModelTokenShare[]>,
  t: TFunction<'usage'>,
) {
  if (!active || !payload?.length) {
    return null
  }
  const date = payload[0]?.payload?.date
  const promptTokens = Number(payload.find(entry => entry.dataKey === 'promptTokens')?.value ?? 0)
  const completionTokens = Number(payload.find(entry => entry.dataKey === 'completionTokens')?.value ?? 0)
  const shares = date ? modelSharesByDate.get(date) ?? [] : []
  return (
    <div className={cn(TOOLTIP_CARD_CLASS, 'min-w-52')}>
      {date && <p className="font-medium text-foreground">{format(parseISO(date), 'PP')}</p>}
      <div className="mt-1 space-y-0.5">
        <TrendTooltipRow label={t('trend.prompt')} value={promptTokens} color="#3b82f6" />
        <TrendTooltipRow label={t('trend.completion')} value={completionTokens} color="#93c5fd" />
      </div>
      <ModelShareRows shares={shares} tone="default" />
    </div>
  )
}

function renderCostTooltip(
  active: boolean | undefined,
  payload: ReadonlyArray<TrendTooltipEntry> | undefined,
  t: TFunction<'usage'>,
) {
  if (!active || !payload?.length) {
    return null
  }
  const date = payload[0]?.payload?.date
  const value = Number(payload[0]?.value ?? 0)
  return (
    <div className={cn(TOOLTIP_CARD_CLASS, 'min-w-40')}>
      {date && <p className="font-medium text-foreground">{format(parseISO(date), 'PP')}</p>}
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {t('trend.cost')}
        </span>
        <span className="font-mono font-medium tabular-nums text-foreground">{formatUsd(value)}</span>
      </div>
    </div>
  )
}

function TrendTooltipRow({ label, value, color }: { label: string, value: number, color: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="font-mono font-medium tabular-nums text-foreground">{formatTokenCount(value)}</span>
    </div>
  )
}
