// Bento-style headline stat cards — replaces the old flat row of gray pills.
// Each card owns one semantic accent color, an animated count-up, a
// background sparkline for the active time range, and a real period-over-
// period delta computed client-side from the daily series.
import { FireFill, FireLine, TrendingDownLine, TrendingUpLine } from '@mingcute/react'
import { m } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'
import { formatTokenCount, formatUsd } from '~/lib/number-format'

import { AnimatedNumber } from './animated-number'
import { comparePeriods, denseCostSeries, denseTokenSeries } from './usage-insights'
import { UsageMiniSpark } from './usage-mini-spark'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'
import type { CostSummary, DailyCost, DailyUsage, UsageStats, UsageSummary } from './use-usage-overview'

interface UsageHeroCardsProps {
  daily: DailyUsage[]
  dailyCost: DailyCost[]
  summary: UsageSummary
  stats: UsageStats
  costSummary: CostSummary | null
  range: UsageRangeKey
}

// apps/web's own `--accent` token is a neutral hover fill (see styles.css),
// not a brand color, so — matching the existing convention in
// features/chat/context/context-usage-detail-panel.tsx — these cards use
// Tailwind's default color scale directly for real, visible color.
//
// Deliberately restrained to two hues (blue = volume, emerald = money) so
// the four cards read as one cohesive family rather than a rainbow — the
// streak card stays neutral and lets its flame icon carry the only warm
// accent in the row.
const CARD_ACCENT = {
  cost: { ring: 'ring-emerald-500/15', dot: 'bg-emerald-500', spark: '#10b981' },
  tokens: { ring: 'ring-blue-500/15', dot: 'bg-blue-500', spark: '#3b82f6' },
  turns: { ring: 'ring-sky-500/15', dot: 'bg-sky-500', spark: '#0ea5e9' },
  streak: { ring: 'ring-foreground/8', dot: 'bg-rose-500', spark: '#f43f5e' },
} as const

export function UsageHeroCards({ daily, dailyCost, summary, stats, costSummary, range }: UsageHeroCardsProps) {
  const { t } = useTranslation('usage')
  const days = rangeDays(range)
  const denseTokens = denseTokenSeries(daily, days)
  const denseCost = denseCostSeries(dailyCost, days)

  const tokenTrend = denseTokens.map(d => d.totalTokens)
  const costTrend = denseCost.map(d => d.costUsd)
  const turnTrend = denseTokens.map(d => d.count)

  const tokenComparison = comparePeriods(tokenTrend, days)
  const costComparison = comparePeriods(costTrend, days)
  const turnComparison = comparePeriods(turnTrend, days)

  const hasCost = Boolean(costSummary && costSummary.totalCostUsd > 0)
  const promptShare = summary.totalTokens > 0 ? summary.totalPromptTokens / summary.totalTokens : 0

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {hasCost && (
        <HeroCard
          index={0}
          accent={CARD_ACCENT.cost}
          label={t('hero.totalCost')}
          value={<AnimatedNumber value={costSummary!.totalCostUsd} formatter={formatUsd} className="text-2xl font-semibold tabular-nums text-foreground" />}
          delta={costComparison.changePct}
          deltaLabel={t('hero.vsPreviousRange', { days })}
          sparkline={costTrend}
          dataTestId="usage-hero-cost"
        />
      )}
      <HeroCard
        index={1}
        accent={CARD_ACCENT.tokens}
        label={t('hero.totalTokens')}
        value={<AnimatedNumber value={summary.totalTokens} formatter={formatTokenCount} className="text-2xl font-semibold tabular-nums text-foreground" dataTestId="usage-total-tokens" />}
        delta={tokenComparison.changePct}
        deltaLabel={t('hero.vsPreviousRange', { days })}
        sparkline={tokenTrend}
        dataTestId="usage-hero-tokens"
        footer={(
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.round(promptShare * 100)}%` }} />
          </div>
        )}
      />
      <HeroCard
        index={2}
        accent={CARD_ACCENT.turns}
        label={t('hero.totalTurns')}
        value={<AnimatedNumber value={summary.totalTurns} formatter={value => value.toLocaleString()} className="text-2xl font-semibold tabular-nums text-foreground" />}
        delta={turnComparison.changePct}
        deltaLabel={t('hero.vsPreviousRange', { days })}
        sparkline={turnTrend}
        dataTestId="usage-hero-turns"
      />
      <HeroCard
        index={3}
        accent={CARD_ACCENT.streak}
        label={t('hero.streak')}
        value={(
          <span className="flex items-baseline gap-1.5">
            <FlameIcon active={stats.currentStreak > 0} />
            <AnimatedNumber value={stats.currentStreak} formatter={value => String(value)} className="text-2xl font-semibold tabular-nums text-foreground" />
          </span>
        )}
        delta={null}
        deltaLabel={t('hero.bestStreakValue', { days: stats.longestStreak })}
        sparkline={null}
        dataTestId="usage-hero-streak"
      />
    </div>
  )
}

function HeroCard({
  index,
  accent,
  label,
  value,
  delta,
  deltaLabel,
  sparkline,
  footer,
  dataTestId,
}: {
  index: number
  accent: typeof CARD_ACCENT[keyof typeof CARD_ACCENT]
  label: string
  value: React.ReactNode
  delta: number | null
  deltaLabel: string
  sparkline: number[] | null
  footer?: React.ReactNode
  dataTestId?: string
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 35, delay: index * 0.04 }}
      className={cn(
        'group relative overflow-hidden rounded-2xl bg-card p-4 ring-1 transition-[box-shadow,transform] duration-150',
        'shadow-[0_1px_2px_rgba(0,0,0,0.03),0_4px_10px_-4px_rgba(0,0,0,0.04)]',
        'hover:-translate-y-px hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_10px_20px_-6px_rgba(0,0,0,0.07)]',
        accent.ring,
      )}
      data-testid={dataTestId}
    >
      {sparkline && sparkline.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 opacity-70">
          <UsageMiniSpark data={sparkline} color={accent.spark} height={36} className="w-full" />
        </div>
      )}
      <div className="relative flex items-center gap-1.5">
        <span className={cn('size-1.5 rounded-full', accent.dot)} />
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="relative mt-1.5">{value}</div>
      <div className="relative mt-1 flex items-center gap-1 text-[10.5px] text-muted-foreground">
        {delta !== null && <DeltaBadge changePct={delta} />}
        <span className="truncate">{deltaLabel}</span>
      </div>
      {footer}
    </m.div>
  )
}

function DeltaBadge({ changePct }: { changePct: number }) {
  const rounded = Math.round(changePct)
  if (rounded === 0) {
    return <span className="tabular-nums text-muted-foreground/70">·</span>
  }
  const isUp = rounded > 0
  const TrendIcon = isUp ? TrendingUpLine : TrendingDownLine
  return (
    <span className={cn('flex items-center gap-0.5 font-medium tabular-nums', isUp ? 'text-success' : 'text-muted-foreground')}>
      <TrendIcon className="!size-3 shrink-0" />
      {Math.abs(rounded)}
%
    </span>
  )
}

function FlameIcon({ active }: { active: boolean }) {
  const Icon = active ? FireFill : FireLine
  return <Icon className={cn('!size-4 shrink-0', active ? 'text-rose-500' : 'text-muted-foreground/40')} />
}
