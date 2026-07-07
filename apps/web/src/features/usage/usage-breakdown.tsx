// Model / Agent / Provider breakdown. All three dimensions are just
// different groupings of the exact same underlying usage rows, so they all
// sum to the same grand total — shown once, big, in the section header —
// with the three columns underneath as supporting detail lists rather than
// each repeating their own "big number" (that felt redundant/oversized).
// Each row's own background fill *is* the progress indicator (no separate
// track-and-bar element), plus a real "$ / 1M tokens" efficiency figure
// computed from existing cost + token totals (no new data needed).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ScrollArea } from '~/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'
import { formatPercentFromRatio, formatTokenCount, formatUsd } from '~/lib/number-format'

import { categoryColor } from './usage-palette'
import type { CostSummary, UsageSummary } from './use-usage-overview'

type BreakdownMode = 'tokens' | 'cost'

interface BreakdownRow {
  key: string
  label: string
  tokens: number
  costUsd: number | null
  count: number
}

interface UsageBreakdownProps {
  summary: UsageSummary
  costSummary: CostSummary | null
}

export function UsageBreakdown({ summary, costSummary }: UsageBreakdownProps) {
  const { t } = useTranslation('usage')
  const [mode, setMode] = useState<BreakdownMode>('tokens')
  const hasCost = Boolean(costSummary && costSummary.totalCostUsd > 0)
  const activeMode = hasCost ? mode : 'tokens'

  const dimensions = useMemo(() => ({
    models: buildRows(summary.byModel.map(item => ({ key: item.modelId, label: item.modelId, totalTokens: item.totalTokens, count: item.count })), costSummary?.byModel.map(item => ({ key: item.modelId, costUsd: item.costUsd })) ?? []),
    agents: buildRows(summary.byAgent.map(item => ({ key: item.agentId, label: item.agentName, totalTokens: item.totalTokens, count: item.count })), costSummary?.byAgent.map(item => ({ key: item.agentId, costUsd: item.costUsd })) ?? []),
    providers: buildRows(summary.byProviderTarget.map(item => ({ key: item.providerTargetId, label: item.providerTargetName ?? item.providerTargetId, totalTokens: item.totalTokens, count: item.count })), costSummary?.byProviderTarget.map(item => ({ key: item.providerTargetId, costUsd: item.costUsd })) ?? []),
  }), [summary, costSummary])

  const availableDimensions = (['models', 'agents', 'providers'] as const).filter(key => dimensions[key].length > 0)
  if (availableDimensions.length === 0) {
    return null
  }

  const grandTotal = activeMode === 'cost' ? (costSummary?.totalCostUsd ?? 0) : summary.totalTokens

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-violet-500" />
            <h2 className="text-sm font-semibold text-foreground">{t('breakdown.title')}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('breakdown.description')}</p>
        </div>
        <div className="text-right">
          {hasCost && (
            <ToggleGroup
              type="single"
              value={activeMode}
              onValueChange={(value) => { if (value === 'tokens' || value === 'cost') { setMode(value) } }}
              variant="outline"
              size="sm"
              className="ml-auto h-7 shrink-0 gap-px rounded-md"
            >
              <ToggleGroupItem value="tokens" className="h-7 px-2.5 text-xs">{t('breakdown.toggleTokens')}</ToggleGroupItem>
              <ToggleGroupItem value="cost" className="h-7 px-2.5 text-xs">{t('breakdown.toggleCost')}</ToggleGroupItem>
            </ToggleGroup>
          )}
          <p className={cn('text-2xl font-semibold tabular-nums text-foreground', hasCost && 'mt-2')}>
            {activeMode === 'cost' ? formatUsd(grandTotal) : formatTokenCount(grandTotal)}
          </p>
          <p className="text-[10.5px] text-muted-foreground">{t('breakdown.total')}</p>
        </div>
      </div>

      <div
        className={cn(
          'mt-5 grid grid-cols-1 gap-8 divide-y divide-foreground/6 sm:divide-y-0',
          availableDimensions.length === 3 && 'lg:grid-cols-3 lg:divide-x',
          availableDimensions.length === 2 && 'sm:grid-cols-2 sm:divide-x',
        )}
      >
        {availableDimensions.map((key, columnIndex) => {
          const rows = [...dimensions[key]].sort((a, b) => (activeMode === 'cost' ? (b.costUsd ?? 0) - (a.costUsd ?? 0) : b.tokens - a.tokens))
          const total = rows.reduce((sum, row) => sum + (activeMode === 'cost' ? (row.costUsd ?? 0) : row.tokens), 0)
          return (
            <div key={key} className={cn('min-w-0', columnIndex > 0 && 'pt-6 sm:pt-0 sm:pl-8')}>
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-normal text-muted-foreground">{t(`breakdown.dimension.${key}`)}</h3>
              <BreakdownList rows={rows} mode={activeMode} total={total} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function buildRows(
  base: Array<{ key: string, label: string, totalTokens: number, count: number }>,
  costs: Array<{ key: string, costUsd: number }>,
): BreakdownRow[] {
  const costLookup = new Map(costs.map(item => [item.key, item.costUsd]))
  return base.map(item => ({
    key: item.key,
    label: item.label,
    tokens: item.totalTokens,
    count: item.count,
    costUsd: costLookup.get(item.key) ?? null,
  }))
}

function BreakdownList({ rows, mode, total }: { rows: BreakdownRow[], mode: BreakdownMode, total: number }) {
  return (
    <ScrollArea className="min-w-0 max-h-64 pr-2" viewportClassName="max-h-64" contentClassName="space-y-1">
      {rows.map((row, index) => (
        <BreakdownBarRow key={row.key} row={row} index={index} mode={mode} total={total} />
      ))}
    </ScrollArea>
  )
}

// Each row *is* the progress indicator — its own background fills left-to-
// right by share, instead of pairing the text with a separate track-and-bar
// element underneath.
function BreakdownBarRow({ row, index, mode, total }: { row: BreakdownRow, index: number, mode: BreakdownMode, total: number }) {
  const { t } = useTranslation('usage')
  const value = mode === 'cost' ? (row.costUsd ?? 0) : row.tokens
  const share = total > 0 ? value / total : 0
  const efficiency = row.costUsd !== null && row.tokens > 0 ? (row.costUsd / row.tokens) * 1_000_000 : null
  const color = categoryColor(index)

  return (
    <div className="relative min-w-0 overflow-hidden rounded-lg">
      <div
        className="absolute inset-y-0 left-0 rounded-lg transition-[width] duration-300"
        style={{ width: `${Math.max(share * 100, 1.5)}%`, backgroundColor: color, opacity: 0.12 }}
      />
      <div className="relative flex items-center justify-between gap-3 px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="min-w-0 truncate font-mono text-xs text-foreground">{row.label}</span>
        </span>
        <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">
          {mode === 'cost' ? formatUsd(value) : formatTokenCount(value)}
        </span>
      </div>
      <div className="relative flex items-center justify-between gap-3 px-2.5 pb-1.5 text-[10px] text-muted-foreground">
        <span className={cn('truncate', mode === 'cost' && efficiency !== null && 'flex items-center gap-1.5')}>
          {t('breakdown.turnCount', { value: row.count.toLocaleString() })}
          {mode === 'cost' && efficiency !== null && (
            <span className="text-muted-foreground/70">
·
{t('breakdown.perMillion', { value: formatUsd(efficiency) })}
            </span>
          )}
        </span>
        <span className="shrink-0 tabular-nums">{formatPercentFromRatio(share)}</span>
      </div>
    </div>
  )
}
