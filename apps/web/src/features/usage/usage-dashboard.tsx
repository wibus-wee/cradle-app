import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { useResolvedThemeMode } from '~/store/theme'

import { UsageDashboardView } from './usage-dashboard-view'
import { buildUsageCsv, downloadUsageCsv } from './usage-export'
import { useUsagePreferencesStore } from './usage-preferences-store'
import { useFleetUsage } from './use-fleet-usage'
import { useUsageOverview } from './use-usage-overview'

export function UsageDashboard() {
  // Range lives here (not in the View) because the tools query is
  // server-aggregated per range — see useUsageOverview.
  const range = useUsagePreferencesStore(state => state.range)
  const setRange = useUsagePreferencesStore(state => state.setRange)
  const usage = useUsageOverview(range)
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const themeMode = useResolvedThemeMode()

  const localSeries = useMemo(() => ({
    daily: usage.daily,
    dailyByModel: usage.dailyByModel,
    dailyCost: usage.dailyCost,
    hourly: usage.hourly,
    costEfficiency: usage.costEfficiency,
    summary: usage.summary,
    costSummary: usage.costSummary,
    tools: usage.tools,
    performance: usage.performance,
  }), [
    usage.daily,
    usage.dailyByModel,
    usage.dailyCost,
    usage.hourly,
    usage.costEfficiency,
    usage.summary,
    usage.costSummary,
    usage.tools,
    usage.performance,
  ])
  const fleet = useFleetUsage(localSeries, range, usage.usageReady)
  // With a Fabric fleet every surface shows fleet-wide merged data; without
  // one the View receives this device's local data untouched.
  const merged = fleet?.merged ?? null
  const dashboardDaily = merged?.daily ?? usage.daily
  const dashboardDailyCost = merged?.dailyCost ?? usage.dailyCost

  return (
    <UsageDashboardView
      daily={dashboardDaily}
      dailyByModel={merged?.dailyByModel ?? usage.dailyByModel}
      hourly={merged?.hourly ?? usage.hourly}
      summary={merged?.summary ?? usage.summary}
      stats={merged?.stats ?? usage.stats}
      costSummary={merged?.costSummary ?? usage.costSummary}
      dailyCost={dashboardDailyCost}
      tools={merged?.tools ?? usage.tools}
      costEfficiency={merged?.costEfficiency ?? usage.costEfficiency}
      performance={merged?.performance ?? usage.performance}
      fleet={fleet}
      usageReady={usage.usageReady}
      range={range}
      onRangeChange={setRange}
      onExport={() => downloadUsageCsv(buildUsageCsv(dashboardDaily, dashboardDailyCost, range), range)}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true)
        void Promise.all([
          usage.refetch(),
          queryClient.invalidateQueries({
            predicate: query => query.queryKey[0] === 'node-upstream'
              && query.queryKey[2] === 'usage-fleet',
          }),
        ]).finally(() => setRefreshing(false))
      }}
      themeMode={themeMode}
    />
  )
}
