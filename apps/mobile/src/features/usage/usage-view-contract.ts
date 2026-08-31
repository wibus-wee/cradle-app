import type {
  GetUsageDailyResponse,
  GetUsageStatsResponse,
  GetUsageSummaryResponse,
} from '@/api-gen'

import type { UsageRange } from './usage-range'

export interface UsageViewProps {
  daily: GetUsageDailyResponse
  isRefreshing?: boolean
  onRangeChange: (range: UsageRange) => void
  onRefresh?: () => Promise<void> | void
  range: UsageRange
  stats: GetUsageStatsResponse
  summary: GetUsageSummaryResponse
}
