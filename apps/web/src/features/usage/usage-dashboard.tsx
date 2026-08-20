import { useState } from 'react'

import { useResolvedThemeMode } from '~/store/theme'

import { UsageDashboardView } from './usage-dashboard-view'
import type { UsageRangeKey } from './usage-time-range'
import { useFleetUsage } from './use-fleet-usage'
import { useUsageOverview } from './use-usage-overview'

export function UsageDashboard() {
  // Range lives here (not in the View) because the tools query is
  // server-aggregated per range — see useUsageOverview.
  const [range, setRange] = useState<UsageRangeKey>('30d')
  const usage = useUsageOverview(range)
  const themeMode = useResolvedThemeMode()
  const fleet = useFleetUsage(
    { daily: usage.daily, dailyByModel: usage.dailyByModel, dailyCost: usage.dailyCost },
    usage.usageReady,
  )

  return (
    <UsageDashboardView
      daily={usage.daily}
      dailyByModel={usage.dailyByModel}
      hourly={usage.hourly}
      summary={usage.summary}
      stats={usage.stats}
      costSummary={usage.costSummary}
      dailyCost={usage.dailyCost}
      tools={usage.tools}
      costEfficiency={usage.costEfficiency}
      performance={usage.performance}
      fleet={fleet}
      usageReady={usage.usageReady}
      range={range}
      onRangeChange={setRange}
      themeMode={themeMode}
    />
  )
}
