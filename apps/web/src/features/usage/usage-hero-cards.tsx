// Headline KPI row — deliberately card-less. Everything further down the
// page (heatmap, breakdown, patterns) lives inside a bordered card, so this
// row's whole job is to look and feel different: big, quiet typography with
// nothing but whitespace and hairline dividers between the numbers, the way
// Vercel/Linear open their own analytics pages. The numbers do the talking;
// a border would only get in the way.
//
// Absolute totals follow the selected range (7D/30D/…): densified series are
// built for 2× the window so comparePeriods can contrast "current N days" vs
// the N days immediately before. Streak is all-history by nature.
import { FireFill, FireLine, TrendingDownLine, TrendingUpLine } from '@mingcute/react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'
import { formatTokenCount, formatUsd } from '~/lib/number-format'

import { AnimatedNumber } from './animated-number'
import { comparePeriods, denseCostSeries, denseTokenSeries } from './usage-insights'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'
import type { DailyCost, DailyUsage, UsageStats } from './use-usage-overview'

interface UsageHeroCardsProps {
  daily: DailyUsage[]
  dailyCost: DailyCost[]
  stats: UsageStats
  range: UsageRangeKey
  hasCost: boolean
}

// Deliberately restrained to two hues (blue = volume, emerald = money) plus
// one warm accent reserved only for the streak flame, so the row reads as
// one cohesive family rather than a rainbow.
const DOT = {
  cost: 'bg-emerald-500',
  tokens: 'bg-blue-500',
  turns: 'bg-sky-500',
  streak: 'bg-rose-500',
} as const

export function UsageHeroCards({ daily, dailyCost, stats, range, hasCost }: UsageHeroCardsProps) {
  const { t } = useTranslation('usage')
  const days = rangeDays(range)
  // 2× window so comparePeriods has a real previous period to contrast against.
  const denseTokens = denseTokenSeries(daily, days * 2)
  const denseCost = denseCostSeries(dailyCost, days * 2)

  const tokenComparison = comparePeriods(denseTokens.map(d => d.totalTokens), days)
  const costComparison = comparePeriods(denseCost.map(d => d.costUsd), days)
  const turnComparison = comparePeriods(denseTokens.map(d => d.count), days)

  const vsRangeLabel = t('hero.vsPreviousRange', { days })
  const showCost = hasCost && costComparison.currentTotal > 0

  const items = [
    showCost && {
      key: 'cost',
      dot: DOT.cost,
      label: t('hero.totalCost'),
      value: <AnimatedNumber value={costComparison.currentTotal} formatter={formatUsd} className="text-3xl font-semibold tabular-nums text-foreground" />,
      delta: costComparison.changePct,
      deltaLabel: vsRangeLabel,
      dataTestId: 'usage-hero-cost',
    },
    {
      key: 'tokens',
      dot: DOT.tokens,
      label: t('hero.totalTokens'),
      value: <AnimatedNumber value={tokenComparison.currentTotal} formatter={formatTokenCount} className="text-3xl font-semibold tabular-nums text-foreground" dataTestId="usage-total-tokens" />,
      delta: tokenComparison.changePct,
      deltaLabel: vsRangeLabel,
      dataTestId: 'usage-hero-tokens',
    },
    {
      key: 'turns',
      dot: DOT.turns,
      label: t('hero.totalTurns'),
      value: <AnimatedNumber value={turnComparison.currentTotal} formatter={value => value.toLocaleString()} className="text-3xl font-semibold tabular-nums text-foreground" />,
      delta: turnComparison.changePct,
      deltaLabel: vsRangeLabel,
      dataTestId: 'usage-hero-turns',
    },
    {
      key: 'streak',
      dot: DOT.streak,
      label: t('hero.streak'),
      value: (
        <span className="flex items-baseline gap-1.5">
          <FlameIcon active={stats.currentStreak > 0} />
          <AnimatedNumber value={stats.currentStreak} formatter={value => String(value)} className="text-3xl font-semibold tabular-nums text-foreground" />
        </span>
      ),
      delta: null,
      deltaLabel: t('hero.bestStreakValue', { days: stats.longestStreak }),
      dataTestId: 'usage-hero-streak',
    },
  ].filter(Boolean) as Array<{ key: string, dot: string, label: string, value: React.ReactNode, delta: number | null, deltaLabel: string, dataTestId: string }>

  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-6">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 && <div aria-hidden="true" className="hidden self-stretch w-px bg-foreground/8 sm:block" />}
          <div className="min-w-[132px]" data-testid={item.dataTestId}>
            <div className="flex items-center gap-1.5">
              <span className={cn('size-1.5 rounded-full', item.dot)} />
              <span className="text-[11px] font-medium text-muted-foreground">{item.label}</span>
            </div>
            <div className="mt-1.5">{item.value}</div>
            <div className="mt-1 flex items-center gap-1 text-[10.5px] text-muted-foreground">
              {item.delta !== null && <DeltaBadge changePct={item.delta} />}
              <span className="truncate">{item.deltaLabel}</span>
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  )
}

function FlameIcon({ active }: { active: boolean }) {
  const Icon = active ? FireFill : FireLine
  return <Icon className={cn('!size-5 shrink-0', active ? 'text-rose-500' : 'text-muted-foreground/40')} />
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
