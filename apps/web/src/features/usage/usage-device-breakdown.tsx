// Per-device breakdown for Fabric fleets. Each device row *is* its own
// progress indicator (same visual language as UsageBreakdown), with tokens /
// cost toggle, turns and active days computed from the device's daily series
// inside the selected range. Unavailable nodes are listed muted at the
// bottom so the section never silently drops a Fabric member.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'
import { formatPercentFromRatio, formatTokenCount, formatUsd } from '~/lib/number-format'

import { lastDateKeys } from './usage-date'
import type { FleetUsage } from './usage-fleet'
import { categoryColor } from './usage-palette'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'

type DeviceBreakdownMode = 'tokens' | 'cost'

interface DeviceRow {
  key: string
  label: string
  platform: string | null
  tokens: number
  costUsd: number
  turns: number
  activeDays: number
}

interface UsageDeviceBreakdownProps {
  fleet: FleetUsage
  range: UsageRangeKey
}

export function UsageDeviceBreakdown({ fleet, range }: UsageDeviceBreakdownProps) {
  const { t } = useTranslation('usage')
  const [mode, setMode] = useState<DeviceBreakdownMode>('tokens')

  const rows = useMemo<DeviceRow[]>(() => {
    const inRange = new Set(lastDateKeys(rangeDays(range)))
    return fleet.devices.map((device) => {
      const daily = device.daily.filter(entry => inRange.has(entry.date))
      const dailyCost = device.dailyCost.filter(entry => inRange.has(entry.date))
      return {
        key: device.key,
        label: device.label,
        platform: device.platform,
        tokens: daily.reduce((sum, entry) => sum + entry.totalTokens, 0),
        costUsd: dailyCost.reduce((sum, entry) => sum + entry.costUsd, 0),
        turns: daily.reduce((sum, entry) => sum + entry.count, 0),
        activeDays: daily.filter(entry => entry.totalTokens > 0).length,
      }
    })
  }, [fleet, range])

  const hasCost = rows.some(row => row.costUsd > 0)
  const activeMode = hasCost ? mode : 'tokens'
  const sorted = [...rows].sort((a, b) => (activeMode === 'cost' ? b.costUsd - a.costUsd : b.tokens - a.tokens))
  const total = sorted.reduce((sum, row) => sum + (activeMode === 'cost' ? row.costUsd : row.tokens), 0)

  return (
    <div data-testid="usage-device-breakdown">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <h2 className="text-sm font-semibold text-foreground">{t('device.title')}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('device.description')}</p>
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
            {activeMode === 'cost' ? formatUsd(total) : formatTokenCount(total)}
          </p>
          <p className="text-[10.5px] text-muted-foreground">{t('device.total')}</p>
        </div>
      </div>

      <div className="mt-5 space-y-1">
        {sorted.map((row, index) => {
          const value = activeMode === 'cost' ? row.costUsd : row.tokens
          const share = total > 0 ? value / total : 0
          const color = categoryColor(index)
          return (
            <div key={row.key} className="relative min-w-0 overflow-hidden rounded-lg" data-testid={`usage-device-row-${row.key}`}>
              <div
                className="absolute inset-y-0 left-0 rounded-lg transition-[width] duration-300"
                style={{ width: `${Math.max(share * 100, 1.5)}%`, backgroundColor: color, opacity: 0.12 }}
              />
              <div className="relative flex items-center justify-between gap-3 px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <span className="min-w-0 truncate text-xs font-medium text-foreground">{row.label}</span>
                  {row.platform && (
                    <span className="shrink-0 text-[10px] text-muted-foreground/80">{row.platform}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">
                  {activeMode === 'cost' ? formatUsd(value) : formatTokenCount(value)}
                </span>
              </div>
              <div className="relative flex items-center justify-between gap-3 px-2.5 pb-1.5 text-[10px] text-muted-foreground">
                <span className="truncate">
                  {t('breakdown.turnCount', { value: row.turns.toLocaleString() })}
                  {' · '}
                  {t('device.activeDays', { count: row.activeDays })}
                </span>
                <span className="shrink-0 tabular-nums">{formatPercentFromRatio(share)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {fleet.unavailable.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-foreground/6 pt-3">
          {fleet.unavailable.map(device => (
            <div key={device.key} className="flex items-center justify-between gap-3 px-2.5 py-1 text-xs text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                <span className="min-w-0 truncate">{device.label}</span>
                {device.platform && <span className="shrink-0 text-[10px] text-muted-foreground/70">{device.platform}</span>}
              </span>
              <span className="shrink-0 text-[10.5px]">
                {device.status === 'offline' ? t('device.status.offline') : t('device.status.unreachable')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
