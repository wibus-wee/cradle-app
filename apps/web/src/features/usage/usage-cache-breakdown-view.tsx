import { format, parseISO } from 'date-fns'
import type { EChartsOption, TooltipComponentFormatterCallbackParams } from 'echarts'
import { BarChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import ReactECharts from 'echarts-for-react'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { formatTokenCount, formatUsd } from '~/lib/number-format'

import { denseCostCompositionSeries } from './usage-insights'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'
import type { CostSummary, DailyCost } from './use-usage-overview'

echarts.use([
  BarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

type CacheChartMetric = 'tokens' | 'cost'
type CompositionKey = 'uncachedInput' | 'cacheRead' | 'cacheWrite' | 'output'

interface UsageCacheBreakdownViewProps {
  costSummary: CostSummary
  dailyCost: DailyCost[]
  range: UsageRangeKey
  themeMode: 'light' | 'dark'
}

const COMPOSITION_KEYS: CompositionKey[] = [
  'uncachedInput',
  'cacheRead',
  'cacheWrite',
  'output',
]

export function UsageCacheBreakdownView({
  costSummary,
  dailyCost,
  range,
  themeMode,
}: UsageCacheBreakdownViewProps) {
  const { t } = useTranslation('usage')
  const [metric, setMetric] = useState<CacheChartMetric>('tokens')
  const days = rangeDays(range)
  const data = useMemo(
    () => denseCostCompositionSeries(dailyCost, days),
    [dailyCost, days],
  )
  const hasCost = costSummary.totalCostUsd > 0
  const activeMetric: CacheChartMetric = hasCost ? metric : 'tokens'
  const option = useMemo(
    () => buildCacheChartOption({
      data,
      metric: activeMetric,
      days,
      isDark: themeMode === 'dark',
      t,
    }),
    [activeMetric, data, days, t, themeMode],
  )
  const summaries = [
    {
      key: 'uncachedInput',
      tokens: costSummary.totalUncachedInputTokens,
      cost: costSummary.uncachedInputCostUsd,
    },
    {
      key: 'cacheRead',
      tokens: costSummary.totalCachedInputTokens,
      cost: costSummary.cacheReadCostUsd,
    },
    {
      key: 'cacheWrite',
      tokens: costSummary.totalCacheWriteInputTokens,
      cost: costSummary.cacheWriteCostUsd,
    },
    {
      key: 'output',
      tokens: costSummary.totalCompletionTokens,
      cost: costSummary.outputCostUsd,
    },
  ] satisfies Array<{ key: CompositionKey, tokens: number, cost: number }>

  return (
    <div data-testid="usage-cache-breakdown">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <h2 className="text-sm font-semibold text-foreground">{t('cache.title')}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('cache.description')}</p>
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
            <ToggleGroupItem value="tokens" className="h-7 px-2.5 text-xs">
              {t('cache.toggleTokens')}
            </ToggleGroupItem>
            <ToggleGroupItem value="cost" className="h-7 px-2.5 text-xs">
              {t('cache.toggleCost')}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-foreground/6 py-4 sm:grid-cols-4">
        {summaries.map(item => (
          <div key={item.key} className="min-w-0">
            <p className="text-[10.5px] text-muted-foreground">{t(`cache.category.${item.key}`)}</p>
            <p className="mt-1 truncate text-lg font-semibold tabular-nums text-foreground">
              {formatTokenCount(item.tokens)}
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
              {formatUsd(item.cost)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <ReactECharts
          key={activeMetric}
          echarts={echarts}
          option={option}
          notMerge={false}
          lazyUpdate
          style={{ height: 240, width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  )
}

interface CacheChartOptionInput {
  data: ReturnType<typeof denseCostCompositionSeries>
  metric: CacheChartMetric
  days: number
  isDark: boolean
  t: TFunction<'usage'>
}

function buildCacheChartOption({
  data,
  metric,
  days,
  isDark,
  t,
}: CacheChartOptionInput): EChartsOption {
  const muted = isDark ? '#a3a3a3' : '#737373'
  const gridline = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'
  const shadow = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
  const colors: Record<CompositionKey, string> = {
    uncachedInput: isDark ? '#60a5fa' : '#2563eb',
    cacheRead: isDark ? '#34d399' : '#059669',
    cacheWrite: isDark ? '#fbbf24' : '#d97706',
    output: isDark ? '#c084fc' : '#9333ea',
  }
  const valueKeys: Record<CacheChartMetric, Record<CompositionKey, keyof (typeof data)[number]>> = {
    tokens: {
      uncachedInput: 'uncachedInputTokens',
      cacheRead: 'cachedInputTokens',
      cacheWrite: 'cacheWriteInputTokens',
      output: 'completionTokens',
    },
    cost: {
      uncachedInput: 'uncachedInputCostUsd',
      cacheRead: 'cacheReadCostUsd',
      cacheWrite: 'cacheWriteCostUsd',
      output: 'outputCostUsd',
    },
  }
  const formatValue = metric === 'cost' ? formatUsd : formatTokenCount

  return {
    animation: true,
    animationDuration: 600,
    animationEasing: 'cubicOut',
    legend: {
      top: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 12,
      textStyle: { color: muted, fontSize: 11 },
    },
    grid: { top: 34, left: 8, right: 8, bottom: 8 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: shadow } },
      backgroundColor: '#0a0a0a',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: '#fff', fontSize: 11 },
      extraCssText: 'border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);',
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const rows = Array.isArray(params) ? params : [params]
        if (rows.length === 0) {
          return ''
        }
        const date = rows[0].name
        const total = rows.reduce((sum, row) => sum + Number(row.value ?? 0), 0)
        const values = rows
          .filter(row => Number(row.value ?? 0) > 0)
          .map(row => `${row.marker ?? ''}${row.seriesName ?? ''}  <b>${formatValue(Number(row.value))}</b>`)
          .join('<br/>')
        return `${date ? `${format(parseISO(date), 'PP')}<br/>` : ''}${t('cache.total')}  <b>${formatValue(total)}</b><br/>${values}`
      },
    },
    xAxis: {
      type: 'category',
      data: data.map(row => row.date),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: muted,
        fontSize: 10,
        hideOverlap: true,
        formatter: (value: string) => format(parseISO(value), days > 90 ? 'MMM' : 'MMM d'),
      },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { lineStyle: { color: gridline, type: 'dashed' } },
    },
    series: COMPOSITION_KEYS.map((key, index) => ({
      name: t(`cache.category.${key}`),
      type: 'bar',
      stack: metric,
      data: data.map(row => Number(row[valueKeys[metric][key]])),
      itemStyle: {
        color: colors[key],
        borderRadius: index === COMPOSITION_KEYS.length - 1 ? [3, 3, 0, 0] : 0,
      },
      barMaxWidth: 24,
      emphasis: { focus: 'series' },
    })),
  }
}
