import { format, parseISO } from 'date-fns'
import type { EChartsOption, TooltipComponentFormatterCallbackParams } from 'echarts'
import { LineChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import ReactECharts from 'echarts-for-react'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { formatShortDurationMs } from '~/lib/number-format'

import { categoryColor } from './usage-palette'
import type { RuntimePerformanceOverview } from './use-usage-overview'

echarts.use([
  LineChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

type PerformanceMetric = 'firstToken' | 'totalDuration'
type PerformancePercentile = 'p50' | 'p95'

interface UsageRuntimePerformanceViewProps {
  performance: RuntimePerformanceOverview
  themeMode: 'light' | 'dark'
}

export function UsageRuntimePerformanceView({
  performance,
  themeMode,
}: UsageRuntimePerformanceViewProps) {
  const { t } = useTranslation('usage')
  const [metric, setMetric] = useState<PerformanceMetric>('firstToken')
  const [percentile, setPercentile] = useState<PerformancePercentile>('p50')
  const option = useMemo(
    () => buildPerformanceChartOption({
      performance,
      metric,
      percentile,
      isDark: themeMode === 'dark',
      t,
    }),
    [metric, percentile, performance, t, themeMode],
  )
  const summary = performance.summary
  const coverage = performance.coverageStartedAt !== null
    && performance.coverageEndedAt !== null
    ? t('performance.coverage', {
        start: format(new Date(performance.coverageStartedAt), 'MMM d, yyyy'),
        end: format(new Date(performance.coverageEndedAt), 'MMM d, yyyy'),
      })
    : null

  return (
    <section data-testid="usage-runtime-performance">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-cyan-500" />
            <h2 className="text-sm font-semibold text-foreground">{t('performance.title')}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('performance.description')}</p>
          {coverage && (
            <p className="mt-1 text-[10.5px] tabular-nums text-muted-foreground">
              {coverage}
            </p>
          )}
        </div>
        {summary.sampleCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              value={metric}
              onValueChange={(value) => {
                if (value === 'firstToken' || value === 'totalDuration') {
                  setMetric(value)
                }
              }}
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-px rounded-md"
            >
              <ToggleGroupItem value="firstToken" className="h-7 px-2.5 text-xs">
                {t('performance.metric.firstToken')}
              </ToggleGroupItem>
              <ToggleGroupItem value="totalDuration" className="h-7 px-2.5 text-xs">
                {t('performance.metric.totalDuration')}
              </ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              type="single"
              value={percentile}
              onValueChange={(value) => {
                if (value === 'p50' || value === 'p95') {
                  setPercentile(value)
                }
              }}
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-px rounded-md"
            >
              <ToggleGroupItem value="p50" className="h-7 px-2.5 text-xs">P50</ToggleGroupItem>
              <ToggleGroupItem value="p95" className="h-7 px-2.5 text-xs">P95</ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
      </div>

      {summary.sampleCount === 0
        ? (
            <p className="mt-6 text-xs text-muted-foreground" data-testid="usage-runtime-performance-empty">
              {t('performance.empty')}
            </p>
          )
        : (
            <>
              <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-foreground/6 py-4 sm:grid-cols-4">
                <PerformanceValue label={t('performance.summary.p50FirstToken')} value={summary.p50FirstTokenMs} />
                <PerformanceValue label={t('performance.summary.p95FirstToken')} value={summary.p95FirstTokenMs} />
                <PerformanceValue label={t('performance.summary.p50TotalDuration')} value={summary.p50TotalDurationMs} />
                <PerformanceValue label={t('performance.summary.p95TotalDuration')} value={summary.p95TotalDurationMs} />
              </div>

              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[10.5px] text-muted-foreground">
                <span>{t('performance.completedRuns', { count: summary.sampleCount })}</span>
                <span>
                  {t('performance.firstTokenCoverage', {
                    count: summary.firstTokenSampleCount,
                    total: summary.sampleCount,
                  })}
                </span>
              </div>

              {performance.daily.length > 0 && (
                <div className="mt-4" data-testid="usage-runtime-performance-chart">
                  <ReactECharts
                    echarts={echarts}
                    option={option}
                    notMerge
                    lazyUpdate
                    style={{ height: 250, width: '100%' }}
                    opts={{ renderer: 'canvas' }}
                  />
                </div>
              )}

              {performance.byRuntime.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-medium text-foreground">{t('performance.runtimeComparison')}</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-left">
                      <thead>
                        <tr className="border-b border-foreground/6 text-[10px] text-muted-foreground">
                          <th className="pb-2 font-medium">{t('performance.runtime')}</th>
                          <th className="pb-2 text-right font-medium">{`${t('performance.metric.firstToken')} P50`}</th>
                          <th className="pb-2 text-right font-medium">{`${t('performance.metric.firstToken')} P95`}</th>
                          <th className="pb-2 text-right font-medium">{`${t('performance.metric.totalDuration')} P50`}</th>
                          <th className="pb-2 text-right font-medium">{`${t('performance.metric.totalDuration')} P95`}</th>
                          <th className="pb-2 text-right font-medium">{t('performance.samples')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {performance.byRuntime.map((runtime, index) => (
                          <tr key={runtime.runtimeKind} className="border-b border-foreground/6 last:border-b-0">
                            <td className="py-2.5 text-xs font-medium text-foreground">
                              <span
                                className="mr-2 inline-block size-1.5 rounded-full"
                                style={{ backgroundColor: categoryColor(index) }}
                              />
                              {runtimeLabel(runtime.runtimeKind)}
                            </td>
                            <DurationCell value={runtime.p50FirstTokenMs} />
                            <DurationCell value={runtime.p95FirstTokenMs} />
                            <DurationCell value={runtime.p50TotalDurationMs} />
                            <DurationCell value={runtime.p95TotalDurationMs} />
                            <td className="py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                              {`${runtime.firstTokenSampleCount}/${runtime.sampleCount}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
    </section>
  )
}

function PerformanceValue({ label, value }: { label: string, value: number | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {formatDuration(value)}
      </p>
    </div>
  )
}

function DurationCell({ value }: { value: number | null }) {
  return (
    <td className="py-2.5 text-right text-xs tabular-nums text-foreground">
      {formatDuration(value)}
    </td>
  )
}

function formatDuration(value: number | null): string {
  return value === null ? '—' : formatShortDurationMs(value)
}

function runtimeLabel(runtimeKind: string): string {
  return runtimeKind
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

interface PerformanceChartOptionInput {
  performance: RuntimePerformanceOverview
  metric: PerformanceMetric
  percentile: PerformancePercentile
  isDark: boolean
  t: TFunction<'usage'>
}

function buildPerformanceChartOption({
  performance,
  metric,
  percentile,
  isDark,
  t,
}: PerformanceChartOptionInput): EChartsOption {
  const dates = [...new Set(performance.daily.map(row => row.date))].sort()
  const runtimes = performance.byRuntime.map(row => row.runtimeKind)
  const muted = isDark ? '#a3a3a3' : '#737373'
  const gridline = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'
  const valueKey = metric === 'firstToken'
    ? percentile === 'p50' ? 'p50FirstTokenMs' : 'p95FirstTokenMs'
    : percentile === 'p50' ? 'p50TotalDurationMs' : 'p95TotalDurationMs'
  const byRuntimeDate = new Map(
    performance.daily.map(row => [`${row.runtimeKind}\u0000${row.date}`, row]),
  )

  return {
    animation: true,
    animationDuration: 500,
    animationEasing: 'cubicOut',
    legend: {
      type: 'scroll',
      top: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 12,
      textStyle: { color: muted, fontSize: 11 },
      formatter: runtimeLabel,
      inactiveColor: isDark ? '#525252' : '#d4d4d4',
    },
    grid: { top: 34, left: 8, right: 8, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0a0a0a',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: '#fff', fontSize: 11 },
      extraCssText: 'border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);',
      formatter: (params: TooltipComponentFormatterCallbackParams) => {
        const rows = Array.isArray(params) ? params : [params]
        const date = rows[0]?.name
        const values = rows
          .filter(row => row.value !== null && row.value !== undefined)
          .map(row => `${row.marker ?? ''}${runtimeLabel(String(row.seriesName ?? ''))}  <b>${formatShortDurationMs(Number(row.value))}</b>`)
          .join('<br/>')
        return `${date ? `${format(parseISO(date), 'PP')}<br/>` : ''}${values}`
      },
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: muted,
        fontSize: 10,
        hideOverlap: true,
        formatter: (value: string) => format(parseISO(value), dates.length > 60 ? 'MMM' : 'MMM d'),
      },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: muted,
        fontSize: 10,
        formatter: (value: number) => formatShortDurationMs(value).replaceAll(' ', ''),
      },
      splitLine: { lineStyle: { color: gridline, type: 'dashed' } },
    },
    series: runtimes.map((runtimeKind, index) => ({
      name: runtimeKind,
      type: 'line',
      data: dates.map(date => byRuntimeDate.get(`${runtimeKind}\u0000${date}`)?.[valueKey] ?? null),
      connectNulls: false,
      showSymbol: dates.length <= 31,
      symbolSize: 5,
      smooth: 0.18,
      lineStyle: { width: 2, color: categoryColor(index) },
      itemStyle: { color: categoryColor(index) },
      emphasis: { focus: 'series' },
    })),
    aria: {
      enabled: true,
      description: t('performance.chartAria', {
        metric: t(`performance.metric.${metric}`),
        percentile: percentile.toUpperCase(),
      }),
    },
  }
}
