import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ScrollArea } from '~/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'
import { boundedPercent, formatPercentFromRatio, formatTokenCount, formatUsd } from '~/lib/number-format'

import { UsageHeatmap } from './usage-heatmap'
import type { DailyCost, DailyUsage } from './use-usage-overview'
import { useUsageOverview } from './use-usage-overview'

/** Tiny SVG sparkline for the last 30 days */
function Sparkline({ data }: { data: DailyUsage[] }) {
  const last30 = data.slice(-30)
  if (last30.length < 2) {
    return null
  }
  const max = Math.max(...last30.map(d => d.totalTokens), 1)
  const w = 180
  const h = 40
  const points = last30.map((d, i) => {
    const x = (i / (last30.length - 1)) * w
    const y = h - (d.totalTokens / max) * (h - 4) - 2
    return `${x},${y}`
  })
  const pathD = `M${points.join(' L')}`
  // Area fill
  const areaD = `${pathD} L${w},${h} L0,${h} Z`

  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sparkFill)" />
      <path d={pathD} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Tiny SVG sparkline for daily cost */
function CostSparkline({ data }: { data: DailyCost[] }) {
  const last30 = data.slice(-30)
  if (last30.length < 2) {
    return null
  }
  const max = Math.max(...last30.map(d => d.costUsd), 0.001)
  const w = 400
  const h = 40
  const points = last30.map((d, i) => {
    const x = (i / (last30.length - 1)) * w
    const y = h - (d.costUsd / max) * (h - 4) - 2
    return `${x},${y}`
  })
  const pathD = `M${points.join(' L')}`
  const areaD = `${pathD} L${w},${h} L0,${h} Z`

  return (
    <svg width={w} height={h} className="overflow-visible" data-testid="cost-sparkline">
      <defs>
        <linearGradient id="costSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#costSparkFill)" />
      <path d={pathD} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function UsageDashboard() {
  const { t, i18n } = useTranslation('usage')
  const [rankingMode, setRankingMode] = useState<'tokens' | 'cost'>('tokens')
  const { daily, summary, stats, costSummary, dailyCost, usageReady, hasData } = useUsageOverview()
  const locale = i18n.language

  const hasRankedUsage = Boolean(
    summary
    && (summary.byModel.length > 0 || summary.byAgent.length > 0 || summary.byProviderTarget.length > 0),
  )

  const hasCostData = Boolean(costSummary && costSummary.totalCostUsd > 0)

  return (
    <div
      className="h-full overflow-y-auto"
      data-testid="usage-dashboard"
      data-usage-ready={usageReady ? 'true' : 'false'}
    >
      <div className="mx-auto max-w-5xl px-8 py-10">
        {/* Header row with streak */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground text-balance" data-testid="usage-dashboard-title">{t('title')}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('description')}</p>
          </div>
          {stats && stats.currentStreak > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-foreground">
              <span className="font-semibold tabular-nums">{stats.currentStreak}</span>
              <span className="text-muted-foreground text-xs">{t('streak.day')}</span>
            </div>
          )}
        </div>

        {/* Stat pills row */}
        {stats && hasData && (
          <div className="mt-6 flex flex-wrap gap-3">
            {costSummary && costSummary.totalCostUsd > 0 && (
              <Pill label={t('pill.totalCost')} value={formatUsd(costSummary.totalCostUsd)} dataTestId="usage-pill-total-cost" accent />
            )}
            <Pill label={t('pill.today')} value={formatTokenCount(stats.todayTokens)} dataTestId="usage-pill-today-tokens" />
            <Pill label={t('pill.prompt')} value={formatTokenCount(summary!.totalPromptTokens)} dataTestId="usage-pill-prompt-tokens" />
            <Pill label={t('pill.completion')} value={formatTokenCount(summary!.totalCompletionTokens)} dataTestId="usage-pill-completion-tokens" />
            <Pill label={t('pill.turns')} value={String(summary!.totalTurns)} dataTestId="usage-pill-total-turns" />
            <Pill label={t('pill.avgDaily')} value={formatTokenCount(stats.avgDailyTokens)} dataTestId="usage-pill-avg-daily-tokens" />
            <Pill label={t('pill.activeDays')} value={String(stats.activeDays)} dataTestId="usage-pill-active-days" />
            <Pill label={t('pill.bestStreak')} value={`${stats.longestStreak}d`} dataTestId="usage-pill-best-streak" />
            {stats.peakDay && (
              <Pill label={t('pill.peak')} value={t('pill.peakValue', { tokens: formatTokenCount(stats.peakDay.totalTokens), date: stats.peakDay.date.slice(5) })} dataTestId="usage-pill-peak-day" />
            )}
          </div>
        )}

        {/* Sparkline + Totals row */}
        {hasData && (
          <div className="mt-8 flex items-end gap-8">
            <div className="flex-1">
              <p className="text-[11px] text-muted-foreground mb-1.5">{t('chart.last30Days')}</p>
              <Sparkline data={daily} />

              {/* Cost sparkline */}
              {dailyCost.length > 1 && (
                <div className="mt-6">
                  <p className="text-[11px] text-muted-foreground mb-1.5">{t('chart.dailyCostLast30Days')}</p>
                  <CostSparkline data={dailyCost} />
                </div>
              )}
            </div>
            <div className="text-right">
              {costSummary && costSummary.totalCostUsd > 0 && (
                <>
                  <p className="text-3xl font-semibold tabular-nums text-foreground" data-testid="usage-total-cost">{formatUsd(costSummary.totalCostUsd)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t('summary.estimatedCost')}</p>
                </>
              )}
              <p
                className={cn(
                  'font-semibold tabular-nums text-foreground',
                  costSummary && costSummary.totalCostUsd > 0 ? 'mt-2 text-lg' : 'text-3xl',
                )}
                data-testid="usage-total-tokens"
              >
                {formatTokenCount(summary!.totalTokens)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{t('summary.totalTokens')}</p>
            </div>
          </div>
        )}

        {/* Heatmap */}
        <div className="mt-8">
          <UsageHeatmap data={daily} />
        </div>

        {/* Top Usage Section */}
        {hasData && hasRankedUsage && (
          <div className="mt-10">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{t('topUsage.title')}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{t('topUsage.description')}</p>
              </div>
              {hasCostData && (
                <ToggleGroup
                  type="single"
                  value={rankingMode}
                  onValueChange={(value) => {
                    if (value === 'tokens' || value === 'cost') {
                      setRankingMode(value)
                    }
                  }}
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-px rounded-md"
                >
                  <ToggleGroupItem value="tokens" className="h-7 px-2.5 text-xs">
                    {t('topUsage.toggleTokens')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="cost" className="h-7 px-2.5 text-xs">
                    {t('topUsage.toggleCost')}
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Models ranking */}
              {rankingMode === 'tokens' && summary!.byModel.length > 0 && (
                <RankGroup title={t('topUsage.models')}>
                  {summary!.byModel.map(item => (
                    <RankedUsageRow
                      key={item.modelId}
                      label={item.modelId}
                      tokens={item.totalTokens}
                      maxTokens={summary!.byModel[0]?.totalTokens ?? 0}
                      totalTokens={summary!.totalTokens}
                      turnsLabel={t('topUsage.turnCount', { value: new Intl.NumberFormat(locale).format(item.count) })}
                    />
                  ))}
                </RankGroup>
              )}
              {rankingMode === 'cost' && costSummary && costSummary.byModel.length > 0 && (
                <RankGroup title={t('topUsage.models')}>
                  {costSummary.byModel.map(item => (
                    <RankedCostRow
                      key={item.modelId}
                      label={item.modelId}
                      costUsd={item.costUsd}
                      maxCost={costSummary.byModel[0]?.costUsd ?? 0}
                      totalCost={costSummary.totalCostUsd}
                      tokens={item.totalTokens}
                    />
                  ))}
                </RankGroup>
              )}
              {/* Agents ranking */}
              {rankingMode === 'tokens' && summary!.byAgent.length > 0 && (
                <RankGroup title={t('topUsage.agents')}>
                  {summary!.byAgent.map(item => (
                    <RankedUsageRow
                      key={item.agentId}
                      label={item.agentName}
                      tokens={item.totalTokens}
                      maxTokens={summary!.byAgent[0]?.totalTokens ?? 0}
                      totalTokens={summary!.totalTokens}
                      turnsLabel={t('topUsage.turnCount', { value: new Intl.NumberFormat(locale).format(item.count) })}
                    />
                  ))}
                </RankGroup>
              )}
              {rankingMode === 'cost' && costSummary && costSummary.byAgent.length > 0 && (
                <RankGroup title={t('topUsage.agents')}>
                  {costSummary.byAgent.map(item => (
                    <RankedCostRow
                      key={item.agentId}
                      label={item.agentName}
                      costUsd={item.costUsd}
                      maxCost={costSummary.byAgent[0]?.costUsd ?? 0}
                      totalCost={costSummary.totalCostUsd}
                      tokens={item.totalTokens}
                    />
                  ))}
                </RankGroup>
              )}
              {/* Providers ranking */}
              {rankingMode === 'tokens' && summary!.byProviderTarget.length > 0 && (
                <RankGroup title={t('topUsage.providers')}>
                  {summary!.byProviderTarget.map(item => (
                    <RankedUsageRow
                      key={item.providerTargetId}
                      label={item.providerTargetName ?? item.providerTargetId}
                      tokens={item.totalTokens}
                      maxTokens={summary!.byProviderTarget[0]?.totalTokens ?? 0}
                      totalTokens={summary!.totalTokens}
                      turnsLabel={t('topUsage.turnCount', { value: new Intl.NumberFormat(locale).format(item.count) })}
                    />
                  ))}
                </RankGroup>
              )}
              {rankingMode === 'cost' && costSummary && costSummary.byProviderTarget.length > 0 && (
                <RankGroup title={t('topUsage.providers')}>
                  {costSummary.byProviderTarget.map(item => (
                    <RankedCostRow
                      key={item.providerTargetId}
                      label={item.providerTargetName ?? item.providerTargetId}
                      costUsd={item.costUsd}
                      maxCost={costSummary.byProviderTarget[0]?.costUsd ?? 0}
                      totalCost={costSummary.totalCostUsd}
                      tokens={item.totalTokens}
                    />
                  ))}
                </RankGroup>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {summary && summary.totalTokens === 0 && (
          <div className="mt-20 text-center" data-testid="usage-empty-state">
            <p className="text-sm text-muted-foreground">
              {t('empty.noData')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Pill({ label, value, dataTestId, accent }: { label: string, value: string, dataTestId?: string, accent?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1',
        accent ? 'border-accent/40 bg-accent/5' : 'border-border/40',
      )}
      data-testid={dataTestId}
    >
      <span className="text-[10px] text-muted-foreground" data-testid={dataTestId ? `${dataTestId}-label` : undefined}>{label}</span>
      <span
        className={cn(
          'text-xs font-medium tabular-nums',
          accent ? 'text-accent-foreground' : 'text-foreground',
        )}
        data-testid={dataTestId ? `${dataTestId}-value` : undefined}
      >
        {value}
      </span>
    </div>
  )
}

function RankGroup({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-normal text-muted-foreground">{title}</h3>
      <ScrollArea
        className="max-h-80 pr-2"
        viewportClassName="max-h-80"
        contentClassName="space-y-3"
      >
        {children}
      </ScrollArea>
    </div>
  )
}

function RankedUsageRow({
  label,
  tokens,
  maxTokens,
  totalTokens,
  turnsLabel,
}: {
  label: string
  tokens: number
  maxTokens: number
  totalTokens: number
  turnsLabel: string
}) {
  const tokenShare = totalTokens > 0 ? tokens / totalTokens : 0
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{label}</span>
        <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">{formatTokenCount(tokens)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/5">
        <div
          className="h-full rounded-full bg-foreground/55"
          style={{ width: `${boundedPercent(tokens, maxTokens)}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
        <span className="truncate">{turnsLabel}</span>
        <span className="shrink-0 tabular-nums">{formatPercentFromRatio(tokenShare)}</span>
      </div>
    </div>
  )
}

function RankedCostRow({
  label,
  costUsd,
  maxCost,
  totalCost,
  tokens,
}: {
  label: string
  costUsd: number
  maxCost: number
  totalCost: number
  tokens: number
}) {
  const costShare = totalCost > 0 ? costUsd / totalCost : 0
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{label}</span>
        <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">{formatUsd(costUsd)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/5">
        <div
          className="h-full rounded-full bg-foreground/55"
          style={{ width: `${boundedPercent(costUsd, maxCost)}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
        <span className="truncate">{formatTokenCount(tokens)}</span>
        <span className="shrink-0 tabular-nums">{formatPercentFromRatio(costShare)}</span>
      </div>
    </div>
  )
}
