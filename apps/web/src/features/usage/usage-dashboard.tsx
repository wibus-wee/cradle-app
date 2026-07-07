import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '~/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'
import { formatTokenCount } from '~/lib/number-format'

import { UsageBreakdown } from './usage-breakdown'
import { UsageHeatmap } from './usage-heatmap'
import { UsageHeroCards } from './usage-hero-cards'
import { UsagePatterns } from './usage-patterns'
import { UsageRecentSessions } from './usage-recent-sessions'
import type { UsageRangeKey } from './usage-time-range'
import { USAGE_RANGE_OPTIONS } from './usage-time-range'
import { UsageTrendChart } from './usage-trend-chart'
import type { UsageStats, UsageSummary } from './use-usage-overview'
import { useUsageOverview } from './use-usage-overview'

export function UsageDashboard() {
  const { t } = useTranslation('usage')
  const [range, setRange] = useState<UsageRangeKey>('30d')
  const { daily, summary, stats, costSummary, dailyCost, usageReady, hasData } = useUsageOverview()

  const hasCost = Boolean(costSummary && costSummary.totalCostUsd > 0)
  const hasRankedUsage = Boolean(
    summary
    && (summary.byModel.length > 0 || summary.byAgent.length > 0 || summary.byProviderTarget.length > 0),
  )

  return (
    <div
      className="h-full overflow-y-auto"
      data-testid="usage-dashboard"
      data-usage-ready={usageReady ? 'true' : 'false'}
    >
      <div className="relative mx-auto max-w-5xl px-8 py-10">
        {/* Soft ambient glow behind the header/hero region — the one deliberate
            spot of "texture" on an otherwise flat, functional page. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-80 w-[640px] -translate-x-1/2 rounded-full bg-blue-500/[0.07] blur-3xl"
        />

        {/* Header row with time range selector */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground text-balance" data-testid="usage-dashboard-title">{t('title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
          </div>
          {hasData && (
            <ToggleGroup
              type="single"
              value={range}
              onValueChange={(value) => {
                if (value) { setRange(value as UsageRangeKey) }
              }}
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-px rounded-md"
            >
              {USAGE_RANGE_OPTIONS.map(option => (
                <ToggleGroupItem key={option.key} value={option.key} className="h-7 px-2.5 text-xs tabular-nums">
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>

        {/* Loading skeleton — first paint only, before any cached data exists */}
        {!usageReady && !hasData && <UsageDashboardSkeleton />}

        {/* Main dashboard body */}
        {usageReady && hasData && summary && stats && (
          <div className="mt-8 space-y-10">
            <UsageHeroCards
              daily={daily}
              dailyCost={dailyCost}
              summary={summary}
              stats={stats}
              costSummary={costSummary}
              range={range}
            />

            <SecondaryStats summary={summary} stats={stats} />

            <SectionCard>
              <UsageTrendChart daily={daily} dailyCost={dailyCost} range={range} hasCost={hasCost} />
            </SectionCard>

            <SectionCard>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-blue-500" />
                  <h2 className="text-sm font-semibold text-foreground">{t('heatmap.title')}</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t('heatmap.description')}</p>
              </div>
              <div className="mt-4">
                <UsageHeatmap data={daily} />
              </div>
            </SectionCard>

            {hasRankedUsage && (
              <SectionCard>
                <UsageBreakdown summary={summary} costSummary={costSummary} />
              </SectionCard>
            )}

            <SectionCard>
              <UsagePatterns daily={daily} summary={summary} />
            </SectionCard>

            <SectionCard>
              <UsageRecentSessions summary={summary} />
            </SectionCard>
          </div>
        )}

        {/* Empty state */}
        {usageReady && summary && summary.totalTokens === 0 && (
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

function SectionCard({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-card p-5 ring-1 ring-foreground/8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_4px_10px_-4px_rgba(0,0,0,0.04)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

const SKELETON_HERO_KEYS = ['hero-1', 'hero-2', 'hero-3', 'hero-4']
const SKELETON_STAT_KEYS = ['stat-1', 'stat-2', 'stat-3', 'stat-4', 'stat-5', 'stat-6']

function UsageDashboardSkeleton() {
  return (
    <div className="mt-8 space-y-10">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SKELETON_HERO_KEYS.map(key => (
          <Skeleton key={key} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {SKELETON_STAT_KEYS.map(key => (
          <Skeleton key={key} className="h-7 w-24 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  )
}

// Secondary detail row — a quiet "meta stats" strip beneath the flashier hero
// cards above. Deliberately neutral/monochrome (color already lives in the
// hero cards and charts — see Von Restorff, if everything is colorful nothing
// stands out), but housed in the same card shell as every other section below
// it so it reads as "grounded detail", not stray floating text.
function SecondaryStats({ summary, stats }: { summary: UsageSummary, stats: UsageStats }) {
  const { t } = useTranslation('usage')
  const cells: Array<{ label: string, value: string, testId: string }> = [
    { label: t('pill.today'), value: formatTokenCount(stats.todayTokens), testId: 'usage-pill-today-tokens' },
    { label: t('pill.prompt'), value: formatTokenCount(summary.totalPromptTokens), testId: 'usage-pill-prompt-tokens' },
    { label: t('pill.completion'), value: formatTokenCount(summary.totalCompletionTokens), testId: 'usage-pill-completion-tokens' },
    { label: t('pill.turns'), value: String(summary.totalTurns), testId: 'usage-pill-total-turns' },
    { label: t('pill.avgDaily'), value: formatTokenCount(stats.avgDailyTokens), testId: 'usage-pill-avg-daily-tokens' },
    { label: t('pill.activeDays'), value: String(stats.activeDays), testId: 'usage-pill-active-days' },
    { label: t('pill.bestStreak'), value: `${stats.longestStreak}d`, testId: 'usage-pill-best-streak' },
  ]
  if (stats.peakDay) {
    cells.push({
      label: t('pill.peak'),
      value: t('pill.peakValue', { tokens: formatTokenCount(stats.peakDay.totalTokens), date: stats.peakDay.date.slice(5) }),
      testId: 'usage-pill-peak-day',
    })
  }

  return (
    <SectionCard className="p-2">
      <div className="flex flex-wrap">
        {cells.map(cell => (
          <div
            key={cell.testId}
            className="min-w-[104px] flex-1 rounded-xl px-3.5 py-2.5 transition-colors duration-150 hover:bg-foreground/[0.03]"
            data-testid={cell.testId}
          >
            <p className="text-[10.5px] text-muted-foreground" data-testid={`${cell.testId}-label`}>{cell.label}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground" data-testid={`${cell.testId}-value`}>{cell.value}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}
