// Hero trend chart - an ECharts stacked bar chart, one bar per day split by
// model (top-N + "other"). ECharts gives us the things the recharts version
// had to hand-roll here: a real legend with color swatches, an axis hover
// tooltip that lists every model's contribution, and canvas-based animation
// that stays smooth even at the 1-year (365-bar) range. The cost view is a
// single-series bar in the same frame.
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
import { useResolvedThemeMode } from '~/store/theme'

import { denseCostSeries, denseModelStackSeries, modelDisplayLabel, OTHER_MODEL_KEY } from './usage-insights'
import { categoryColor } from './usage-palette'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'
import type { DailyCost, DailyUsageByModel } from './use-usage-overview'

// Tree-shake: register only the pieces we use so echarts stays small instead of
// pulling in every chart type and component.
echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

type TrendMetric = 'tokens' | 'cost'

interface UsageTrendChartProps {
  dailyCost: DailyCost[]
  dailyByModel: DailyUsageByModel[]
  range: UsageRangeKey
  hasCost: boolean
}

export function UsageTrendChart({ dailyCost, dailyByModel, range, hasCost }: UsageTrendChartProps) {
  const { t } = useTranslation('usage')
  const resolvedMode = useResolvedThemeMode()
  const isDark = resolvedMode === 'dark'
  const [metric, setMetric] = useState<TrendMetric>('tokens')
  const days = rangeDays(range)
  const activeMetric: TrendMetric = hasCost ? metric : 'tokens'

  const costData = useMemo(() => denseCostSeries(dailyCost, days), [dailyCost, days])
  const tokenStack = useMemo(() => denseModelStackSeries(dailyByModel, days, Infinity), [dailyByModel, days])

  const option = useMemo(
    () => buildTrendOption({ metric: activeMetric, tokenStack, costData, days, isDark, t }),
    [activeMetric, tokenStack, costData, days, isDark, t],
  )

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
        <ReactECharts
          // Remount on metric switch so the stacked-by-model layout and the
          // single cost series don't try to morph into each other; range
          // changes keep the same instance and animate the data transition.
          key={activeMetric}
          echarts={echarts}
          option={option}
          notMerge={false}
          style={{ height: 240, width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  )
}

interface TrendOptionInput {
  metric: TrendMetric
  tokenStack: ReturnType<typeof denseModelStackSeries>
  costData: DailyCost[]
  days: number
  isDark: boolean
  t: TFunction<'usage'>
}

function buildTrendOption({ metric, tokenStack, costData, days, isDark, t }: TrendOptionInput): EChartsOption {
  // Canvas can't resolve CSS vars / currentColor, so pick concrete theme colors
  // from the resolved light/dark mode (recharts got this for free via SVG).
  const muted = isDark ? '#a3a3a3' : '#737373'
  const gridline = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'
  const shadow = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
  const dateLabel = (key: string) => format(parseISO(key), days > 90 ? 'MMM' : 'MMM d')

  const tooltipBase = {
    trigger: 'axis' as const,
    axisPointer: { type: 'shadow' as const, shadowStyle: { color: shadow } },
    backgroundColor: '#0a0a0a',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: '#fff', fontSize: 11 },
    extraCssText: 'border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);',
  }

  const categoryAxis = (data: string[]) => ({
    type: 'category' as const,
    data,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: muted, fontSize: 10, hideOverlap: true, formatter: (v: string) => dateLabel(v) },
  })

  const valueAxis = {
    type: 'value' as const,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: false },
    splitLine: { lineStyle: { color: gridline, type: 'dashed' as const } },
  }

  const animation = {
    animation: true,
    animationDuration: 600,
    animationEasing: 'cubicOut' as const,
    animationDurationUpdate: 400,
    animationEasingUpdate: 'cubicInOut' as const,
  }

  if (metric === 'cost') {
    return {
      ...animation,
      grid: { top: 12, left: 8, right: 8, bottom: 24 },
      tooltip: {
        ...tooltipBase,
        formatter: (params: TooltipComponentFormatterCallbackParams) => {
          const p = Array.isArray(params) ? params[0] : params
          const date = p?.name
          const value = Number(p?.value ?? 0)
          return `${date ? `${format(parseISO(date), 'PP')}<br/>` : ''}${p?.marker ?? ''}${t('trend.cost')}  <b>${formatUsd(value)}</b>`
        },
      },
      xAxis: categoryAxis(costData.map(d => d.date)),
      yAxis: valueAxis,
      series: [{
        type: 'bar',
        name: t('trend.cost'),
        data: costData.map(d => d.costUsd),
        itemStyle: { color: '#10b981', borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 24,
      }],
    }
  }

  const dates = tokenStack.series.map(d => String(d.date))
  const series = tokenStack.models.map((modelId, index) => ({
    name: modelDisplayLabel(modelId, t),
    type: 'bar' as const,
    stack: 'tokens',
    data: tokenStack.series.map(d => Number(d[modelId] ?? 0)),
    itemStyle: {
      color: modelId === OTHER_MODEL_KEY || modelId === 'unknown' ? muted : categoryColor(index),
      borderRadius: index === tokenStack.models.length - 1 ? [3, 3, 0, 0] : 0,
    },
    barMaxWidth: 24,
    emphasis: { focus: 'series' as const },
  }))

  return {
    ...animation,
    legend: {
      type: 'scroll',
      top: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 12,
      textStyle: { color: muted, fontSize: 11 },
      inactiveColor: isDark ? '#525252' : '#d4d4d4',
    },
    grid: { top: 34, left: 8, right: 8, bottom: 24 },
    tooltip: {
      ...tooltipBase,
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const arr = Array.isArray(params) ? params : [params]
        if (!arr.length) {
          return ''
        }
        const date = arr[0].name
        const total = arr.reduce((sum, p) => sum + Number(p.value ?? 0), 0)
        const rows = arr
          .filter(p => Number(p.value ?? 0) > 0)
          .map(p => `${p.marker ?? ''}${p.seriesName ?? ''}  <b>${formatTokenCount(Number(p.value))}</b>`)
          .join('<br/>')
        return `${date ? `${format(parseISO(date), 'PP')}<br/>` : ''}${t('trend.total')}  <b>${formatTokenCount(total)}</b><br/>${rows}`
      },
    },
    xAxis: categoryAxis(dates),
    yAxis: valueAxis,
    series,
  }
}
