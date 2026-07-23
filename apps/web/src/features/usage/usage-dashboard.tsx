import { useResolvedThemeMode } from '~/store/theme'

import { UsageDashboardView } from './usage-dashboard-view'
import { useUsageOverview } from './use-usage-overview'

export function UsageDashboard() {
  const usage = useUsageOverview()
  const themeMode = useResolvedThemeMode()

  return (
    <UsageDashboardView
      daily={usage.daily}
      dailyByModel={usage.dailyByModel}
      hourly={usage.hourly}
      summary={usage.summary}
      stats={usage.stats}
      costSummary={usage.costSummary}
      dailyCost={usage.dailyCost}
      usageReady={usage.usageReady}
      themeMode={themeMode}
    />
  )
}
