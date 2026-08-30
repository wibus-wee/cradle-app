import { Dashboard2Line as GaugeIcon, WarningLine as AlertTriangleIcon } from '@mingcute/react'
import type { ReactNode } from 'react'

import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import { clampPercent } from '~/lib/number-format'

import type { ChatRuntimeUsageUiSlotState } from '../../capabilities/chat-capabilities'

export function UsageSlotContent({
  state,
  action,
  className,
  layout = 'inline',
}: {
  state: ChatRuntimeUsageUiSlotState
  action?: ReactNode
  className?: string
  layout?: 'inline' | 'stacked'
}) {
  const rows = readUsageRows(state)
  const toneClassName = readUsageToneClassName(state)
  const Icon = state.rateLimitReachedType ? AlertTriangleIcon : GaugeIcon

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <Icon className={cn('size-3.5 shrink-0', toneClassName)} aria-hidden="true" />
      <div className="grid min-w-0 flex-1 gap-1.5">
        {rows.map((row, index) => (
          <UsageWindowRow
            key={row.key}
            row={row}
            title={index === 0 ? (state.rateLimitReachedType ? 'Usage limited' : 'Usage') : null}
            layout={layout}
          />
        ))}
        {state.estimatedCostUsd !== undefined && state.estimatedCostUsd !== null && (
          <UsageCostSummary state={state} />
        )}
        {state.lastModelSwitch && <ModelSwitchCostSummary modelSwitch={state.lastModelSwitch} />}
      </div>
      {action}
    </div>
  )
}

function ModelSwitchCostSummary({
  modelSwitch,
}: {
  modelSwitch: NonNullable<ChatRuntimeUsageUiSlotState['lastModelSwitch']>
}) {
  const label = `Last switch: ${formatEstimatedCost(modelSwitch.estimatedCacheWriteUsd)} cache estimate · ${modelSwitch.cacheTtl} TTL · ${modelSwitch.pricing} pricing`
  return (
    <div className="min-w-0 truncate text-muted-foreground">
      {label}
    </div>
  )
}

function UsageCostSummary({ state }: { state: ChatRuntimeUsageUiSlotState }) {
  const costBases = [...new Set(state.modelCosts?.map(item => item.costBasis) ?? [])]
  const pricingLabel = costBases.length === 1
    ? `${costBases[0]} pricing`
    : costBases.length > 1
      ? 'mixed pricing'
      : 'pricing unavailable'
  const modelCount = state.modelCosts?.length ?? 0
  const costLabel = `${formatEstimatedCost(state.estimatedCostUsd ?? 0)} estimated`
  const pricingSummary = `${pricingLabel}${modelCount > 0 ? ` · ${modelCount} model${modelCount === 1 ? '' : 's'}` : ''}`
  const queuedLabel = `· ${state.queuedTurnCount} queued`
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 text-muted-foreground">
      <span className="shrink-0 font-mono tabular-nums text-foreground/80">
        {costLabel}
      </span>
      <span aria-hidden="true">·</span>
      <span className="min-w-0 truncate">
        {pricingSummary}
      </span>
      {(state.queuedTurnCount ?? 0) > 0 && (
        <span className="shrink-0">{queuedLabel}</span>
      )}
    </div>
  )
}

function formatEstimatedCost(costUsd: number): string {
  if (costUsd >= 1) {
    return `$${costUsd.toFixed(2)}`
  }
  if (costUsd >= 0.01) {
    return `$${costUsd.toFixed(3)}`
  }
  return `$${costUsd.toFixed(4)}`
}

interface UsageWindowRowState {
  key: string
  label: string
  remainingPercent: number | null
  resetLabel: string | null
}

function UsageWindowRow({
  row,
  title,
  layout,
}: {
  row: UsageWindowRowState
  title: string | null
  layout: 'inline' | 'stacked'
}) {
  if (layout === 'stacked') {
    return (
      <div className="min-w-0 space-y-1">
        <UsageWindowLabel row={row} title={title} />
        {row.remainingPercent !== null && (
          <Progress value={row.remainingPercent} className="h-1 min-w-0 bg-muted/60" />
        )}
      </div>
    )
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(5rem,9rem)] items-center gap-2">
      <UsageWindowLabel row={row} title={title} />
      {row.remainingPercent !== null && (
        <Progress value={row.remainingPercent} className="h-0.5 min-w-0 bg-muted/60" />
      )}
    </div>
  )
}

function UsageWindowLabel({
  row,
  title,
}: {
  row: UsageWindowRowState
  title: string | null
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      {title && <span className="shrink-0 font-medium text-foreground/75">{title}</span>}
      <span className="shrink-0 text-foreground/80">{row.label}</span>
      <span className="shrink-0 font-mono tabular-nums text-foreground/80">
        {formatRemainingPercent(row.remainingPercent)}
      </span>
      {row.resetLabel && (
        <>
          <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
            ·
          </span>
          <span className="min-w-0 truncate text-muted-foreground">{row.resetLabel}</span>
        </>
      )}
    </div>
  )
}

function readUsageRows(state: ChatRuntimeUsageUiSlotState): UsageWindowRowState[] {
  const hasSecondaryUsageWindow = [
    state.secondaryUsedPercent,
    state.secondaryWindowDurationMins,
    state.secondaryResetsAt,
  ].some(value => value !== null)
  const hasPrimaryUsageWindow = [
    state.limitName,
    state.usedPercent,
    state.primaryWindowDurationMins,
    state.primaryResetsAt,
  ].some(value => value !== null)
  const rows: UsageWindowRowState[] = hasPrimaryUsageWindow
    ? [{
      key: 'primary',
      label: formatWindowDuration(state.primaryWindowDurationMins) ?? state.limitName ?? 'limit',
      remainingPercent: formatRemainingValue(state.usedPercent),
      resetLabel: formatResetLabel(state.primaryResetsAt),
      }]
    : []

  if (hasSecondaryUsageWindow) {
    rows.push({
      key: 'secondary',
      label: formatWindowDuration(state.secondaryWindowDurationMins) ?? 'secondary',
      remainingPercent: formatRemainingValue(state.secondaryUsedPercent),
      resetLabel: formatResetLabel(state.secondaryResetsAt),
    })
  }

  return rows
}

function formatRemainingValue(usedPercent: number | null): number | null {
  if (usedPercent === null) {
    return null
  }
  return clampPercent(100 - clampPercent(usedPercent))
}

function formatRemainingPercent(remainingPercent: number | null): string {
  if (remainingPercent === null) {
    return 'unavailable'
  }
  return `${Math.round(remainingPercent)}% left`
}

function formatWindowDuration(durationMins: number | null): string | null {
  if (durationMins === null || durationMins <= 0) {
    return null
  }
  if (durationMins === 10_080) {
    return 'weekly'
  }
  if (durationMins === 43_200 || durationMins === 43_800 || durationMins === 44_640) {
    return 'monthly'
  }
  if (durationMins % 1_440 === 0) {
    return `${durationMins / 1_440}d`
  }
  if (durationMins % 60 === 0) {
    return `${durationMins / 60}h`
  }
  return `${durationMins}m`
}

function formatResetLabel(resetsAt: number | null): string | null {
  if (resetsAt === null) {
    return null
  }

  const deltaSeconds = resetsAt - Math.floor(Date.now() / 1_000)
  if (deltaSeconds <= 0) {
    return 'reset pending'
  }
  if (deltaSeconds < 3_600) {
    return `resets in ${Math.ceil(deltaSeconds / 60)}m`
  }
  if (deltaSeconds < 86_400) {
    return `resets in ${Math.ceil(deltaSeconds / 3_600)}h`
  }
  return `resets in ${Math.ceil(deltaSeconds / 86_400)}d`
}

function readUsageToneClassName(state: ChatRuntimeUsageUiSlotState): string {
  if (state.rateLimitReachedType) {
    return 'text-destructive'
  }
  if (state.usedPercent !== null && state.usedPercent >= 90) {
    return 'text-amber-600 dark:text-amber-400'
  }
  return 'text-muted-foreground'
}
