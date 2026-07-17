// Hero trend chart - an ECharts stacked bar chart, one bar per day split by
// model (top-N + "other"). ECharts gives us the things the recharts version
// had to hand-roll here: a real legend with color swatches, an axis hover
// tooltip that lists every model's contribution, and canvas-based animation
// that stays smooth even at the 1-year (365-bar) range. The cost view is a
// single-series bar in the same frame.
import {
  AnticlockwiseLine as ResetIcon,
  PlusLine as PlusIcon,
  SubtractLine as MinusIcon,
} from '@mingcute/react'
import { format, parseISO } from 'date-fns'
import type { EChartsOption, TooltipComponentFormatterCallbackParams } from 'echarts'
import { BarChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import ReactECharts from 'echarts-for-react'
import type { TFunction } from 'i18next'
import type { AnimationPlaybackControls } from 'motion/react'
import { animate, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { ButtonGroup } from '~/components/ui/button-group'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { formatTokenCount, formatUsd } from '~/lib/number-format'
import { useResolvedThemeMode } from '~/store/theme'

import {
  denseCostSeries,
  denseModelStackSeries,
  modelDisplayLabel,
  OTHER_MODEL_KEY,
} from './usage-insights'
import { categoryColor } from './usage-palette'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'
import type { DailyCost, DailyUsageByModel } from './use-usage-overview'

// Tree-shake: register only the pieces we use so echarts stays small instead of
// pulling in every chart type and component.
echarts.use([
  BarChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

const FULL_ZOOM: [number, number] = [0, 100]
const MIN_VISIBLE_DAYS = 7
const ZOOM_FACTOR = 0.65

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
  const chartRef = useRef<ReactECharts>(null)
  const zoomAnimationRef = useRef<AnimationPlaybackControls | null>(null)
  const zoomWindowRef = useRef<[number, number]>(FULL_ZOOM)
  const [visibleIndices, setVisibleIndices] = useState<[number, number]>([0, 0])
  const reduceMotion = useReducedMotion()
  const days = rangeDays(range)
  const activeMetric: TrendMetric = hasCost ? metric : 'tokens'

  const costData = useMemo(() => denseCostSeries(dailyCost, days), [dailyCost, days])
  const tokenStack = useMemo(
    () => denseModelStackSeries(dailyByModel, days, Infinity),
    [dailyByModel, days],
  )
  const dates
    = activeMetric === 'cost'
      ? costData.map(row => row.date)
      : tokenStack.series.map(row => String(row.date))
  const minZoomSpan = Math.min(100, (MIN_VISIBLE_DAYS / Math.max(dates.length, 1)) * 100)

  const option = useMemo(
    () =>
      buildTrendOption({
        metric: activeMetric,
        tokenStack,
        costData,
        days,
        isDark,
        t,
        initialZoom: zoomWindowRef.current,
        minZoomSpan,
      }),
    [activeMetric, tokenStack, costData, days, isDark, minZoomSpan, t],
  )

  const syncZoomFromChart = useCallback(() => {
    const dataZoom = chartRef.current?.getEchartsInstance().getOption().dataZoom?.[0]
    const start = Number(dataZoom?.start ?? 0)
    const end = Number(dataZoom?.end ?? 100)
    zoomWindowRef.current = [start, end]

    const lastIndex = Math.max(dates.length - 1, 0)
    const nextIndices: [number, number] = [
      Math.max(0, Math.min(lastIndex, Math.round((lastIndex * start) / 100))),
      Math.max(0, Math.min(lastIndex, Math.round((lastIndex * end) / 100))),
    ]
    setVisibleIndices(current =>
      current[0] === nextIndices[0] && current[1] === nextIndices[1] ? current : nextIndices)
  }, [dates.length])

  const setZoom = useCallback(
    (target: [number, number]) => {
      const chart = chartRef.current?.getEchartsInstance()
      if (!chart) {
        return
      }

      zoomAnimationRef.current?.stop()
      const [fromStart, fromEnd] = zoomWindowRef.current
      const dispatchZoom = (start: number, end: number) => {
        chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start, end })
      }

      if (reduceMotion) {
        dispatchZoom(target[0], target[1])
        return
      }

      zoomAnimationRef.current = animate(0, 1, {
        duration: 0.28,
        ease: [0.22, 1, 0.36, 1],
        onUpdate: progress =>
          dispatchZoom(
            fromStart + (target[0] - fromStart) * progress,
            fromEnd + (target[1] - fromEnd) * progress,
          ),
      })
    },
    [reduceMotion],
  )

  const changeZoom = useCallback(
    (factor: number) => {
      const [start, end] = zoomWindowRef.current
      const center = (start + end) / 2
      const nextSpan = Math.max(minZoomSpan, Math.min(100, (end - start) * factor))
      const nextStart = Math.max(0, Math.min(100 - nextSpan, center - nextSpan / 2))
      setZoom([nextStart, nextStart + nextSpan])
    },
    [minZoomSpan, setZoom],
  )

  const resetZoom = useCallback(() => setZoom(FULL_ZOOM), [setZoom])

  useEffect(() => {
    zoomAnimationRef.current?.stop()
    zoomWindowRef.current = FULL_ZOOM
    setVisibleIndices([0, Math.max(dates.length - 1, 0)])
    chartRef.current?.getEchartsInstance().dispatchAction({
      type: 'dataZoom',
      dataZoomIndex: 0,
      start: FULL_ZOOM[0],
      end: FULL_ZOOM[1],
    })
  }, [dates.length, days])

  useEffect(() => () => zoomAnimationRef.current?.stop(), [])

  const chartEvents = useMemo(
    () => ({
      datazoom: syncZoomFromChart,
      dblclick: resetZoom,
    }),
    [resetZoom, syncZoomFromChart],
  )

  const visibleStart = dates[visibleIndices[0]]
  const visibleEnd = dates[visibleIndices[1]]
  const isZoomed = visibleIndices[0] > 0 || visibleIndices[1] < dates.length - 1
  const canZoomIn
    = dates.length > MIN_VISIBLE_DAYS
      && zoomWindowRef.current[1] - zoomWindowRef.current[0] > minZoomSpan + 0.01

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
            <ToggleGroupItem value="tokens" className="h-7 px-2.5 text-xs">
              {t('trend.toggleTokens')}
            </ToggleGroupItem>
            <ToggleGroupItem value="cost" className="h-7 px-2.5 text-xs">
              {t('trend.toggleCost')}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      <div className="mt-4" data-testid="usage-trend-chart">
        <ReactECharts
          // Remount on metric switch so the stacked-by-model layout and the
          // single cost series don't try to morph into each other; range
          // changes keep the same instance and animate the data transition.
          key={activeMetric}
          ref={chartRef}
          echarts={echarts}
          option={option}
          notMerge={false}
          lazyUpdate
          onEvents={chartEvents}
          style={{ height: 268, width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />

        <div className="mt-1 flex min-h-10 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p
              className="text-xs tabular-nums text-muted-foreground transition-colors duration-200 data-[zoomed=true]:text-foreground"
              data-zoomed={isZoomed ? 'true' : 'false'}
              aria-live="polite"
            >
              {visibleStart && visibleEnd
                ? t('trend.visibleRange', {
                    start: format(parseISO(visibleStart), 'MMM d, yyyy'),
                    end: format(parseISO(visibleEnd), 'MMM d, yyyy'),
                  })
                : null}
            </p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
              {t('trend.interactionHint')}
            </p>
          </div>

          <TooltipProvider delayDuration={350}>
            <ButtonGroup aria-label={t('trend.zoomControls')}>
              <ChartControlButton
                label={t('trend.zoomIn')}
                disabled={!canZoomIn}
                onClick={() => changeZoom(ZOOM_FACTOR)}
              >
                <PlusIcon aria-hidden="true" />
              </ChartControlButton>
              <ChartControlButton
                label={t('trend.zoomOut')}
                disabled={!isZoomed}
                onClick={() => changeZoom(1 / ZOOM_FACTOR)}
              >
                <MinusIcon aria-hidden="true" />
              </ChartControlButton>
              <ChartControlButton
                label={t('trend.resetZoom')}
                disabled={!isZoomed}
                onClick={resetZoom}
              >
                <ResetIcon aria-hidden="true" />
              </ChartControlButton>
            </ButtonGroup>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}

function ChartControlButton({
  label,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-10 active:scale-[0.96]"
            aria-label={label}
            {...props}
          />
        )}
      />
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

interface TrendOptionInput {
  metric: TrendMetric
  tokenStack: ReturnType<typeof denseModelStackSeries>
  costData: DailyCost[]
  days: number
  isDark: boolean
  t: TFunction<'usage'>
  initialZoom: [number, number]
  minZoomSpan: number
}

function buildTrendOption({
  metric,
  tokenStack,
  costData,
  days,
  isDark,
  t,
  initialZoom,
  minZoomSpan,
}: TrendOptionInput): EChartsOption {
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
    axisLabel: {
      color: muted,
      fontSize: 10,
      hideOverlap: true,
      formatter: (v: string) => dateLabel(v),
    },
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

  const dataZoom = [
    {
      type: 'inside' as const,
      xAxisIndex: 0,
      filterMode: 'filter' as const,
      start: initialZoom[0],
      end: initialZoom[1],
      minSpan: minZoomSpan,
      zoomOnMouseWheel: true,
      moveOnMouseMove: true,
      moveOnMouseWheel: false,
      preventDefaultMouseMove: true,
    },
    {
      type: 'slider' as const,
      xAxisIndex: 0,
      filterMode: 'filter' as const,
      start: initialZoom[0],
      end: initialZoom[1],
      minSpan: minZoomSpan,
      height: 18,
      left: 12,
      right: 12,
      bottom: 0,
      showDetail: false,
      brushSelect: true,
      borderColor: 'transparent',
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)',
      fillerColor: isDark ? 'rgba(96,165,250,0.22)' : 'rgba(59,130,246,0.15)',
      dataBackground: {
        lineStyle: { color: isDark ? '#525252' : '#a3a3a3', opacity: 0.45 },
        areaStyle: { color: isDark ? '#404040' : '#d4d4d4', opacity: 0.25 },
      },
      selectedDataBackground: {
        lineStyle: { color: '#3b82f6', opacity: 0.75 },
        areaStyle: { color: '#3b82f6', opacity: 0.18 },
      },
      handleSize: 14,
      handleStyle: {
        color: isDark ? '#171717' : '#ffffff',
        borderColor: isDark ? '#737373' : '#a3a3a3',
        borderWidth: 1,
        shadowBlur: 4,
        shadowColor: isDark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.12)',
      },
      moveHandleSize: 4,
      moveHandleStyle: { color: isDark ? '#737373' : '#a3a3a3', opacity: 0.8 },
      emphasis: {
        handleStyle: { borderColor: '#3b82f6' },
        moveHandleStyle: { color: '#3b82f6' },
      },
    },
  ]

  if (metric === 'cost') {
    return {
      ...animation,
      grid: { top: 12, left: 8, right: 8, bottom: 48 },
      dataZoom,
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
      series: [
        {
          type: 'bar',
          name: t('trend.cost'),
          data: costData.map(d => d.costUsd),
          itemStyle: { color: '#10b981', borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 24,
        },
      ],
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
    grid: { top: 34, left: 8, right: 8, bottom: 48 },
    dataZoom,
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
          .map(
            p =>
              `${p.marker ?? ''}${p.seriesName ?? ''}  <b>${formatTokenCount(Number(p.value))}</b>`,
          )
          .join('<br/>')
        return `${date ? `${format(parseISO(date), 'PP')}<br/>` : ''}${t('trend.total')}  <b>${formatTokenCount(total)}</b><br/>${rows}`
      },
    },
    xAxis: categoryAxis(dates),
    yAxis: valueAxis,
    series,
  }
}
