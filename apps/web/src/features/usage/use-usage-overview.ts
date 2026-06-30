// Reads global Usage API data for dashboard and profile surfaces.
import { useQuery } from '@tanstack/react-query'

import {
  getUsageCostDailyOptions,
  getUsageCostSummaryOptions,
  getUsageDailyOptions,
  getUsageStatsOptions,
  getUsageSummaryOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetUsageCostDailyResponse,
  GetUsageCostSummaryResponse,
  GetUsageDailyResponse,
  GetUsageStatsResponse,
  GetUsageSummaryResponse,
} from '~/api-gen/types.gen'

export type DailyUsage = GetUsageDailyResponse[number]
export type UsageSummary = GetUsageSummaryResponse
export type UsageStats = GetUsageStatsResponse
export type CostSummary = GetUsageCostSummaryResponse
export type DailyCost = GetUsageCostDailyResponse[number]

const EMPTY_DAILY_USAGE: GetUsageDailyResponse = []
const EMPTY_DAILY_COST: GetUsageCostDailyResponse = []

export function useUsageOverview() {
  const dailyQuery = useQuery({
    ...getUsageDailyOptions({ query: { days: '365' } }),
  })
  const summaryQuery = useQuery({
    ...getUsageSummaryOptions(),
  })
  const statsQuery = useQuery({
    ...getUsageStatsOptions(),
  })
  const costSummaryQuery = useQuery({
    ...getUsageCostSummaryOptions(),
  })
  const dailyCostQuery = useQuery({
    ...getUsageCostDailyOptions(),
  })

  const summary = summaryQuery.data ?? null

  return {
    dailyQuery,
    summaryQuery,
    statsQuery,
    costSummaryQuery,
    dailyCostQuery,
    daily: dailyQuery.data ?? EMPTY_DAILY_USAGE,
    summary,
    stats: statsQuery.data ?? null,
    costSummary: costSummaryQuery.data ?? null,
    dailyCost: dailyCostQuery.data ?? EMPTY_DAILY_COST,
    usageReady:
      dailyQuery.isSuccess
      && summaryQuery.isSuccess
      && statsQuery.isSuccess
      && costSummaryQuery.isSuccess
      && dailyCostQuery.isSuccess,
    hasData: Boolean(summary && summary.totalTokens > 0),
  }
}
