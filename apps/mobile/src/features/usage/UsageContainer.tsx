import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import type {
  GetUsageDailyResponse,
  GetUsageStatsResponse,
  GetUsageSummaryResponse,
} from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'

import type { UsageRange } from './usage-range'
import { DEFAULT_USAGE_RANGE, usageRangeDays } from './usage-range'
import { loadUsageRange, persistUsageRange } from './usage-range-storage'
import { UsageView } from './UsageView'

export function UsageContainer() {
  const { connection } = useConnection()
  const isRouteActive = useRouteIsActive()
  const [range, setRange] = useState<UsageRange | null>(null)
  const days = usageRangeDays(range ?? DEFAULT_USAGE_RANGE)
  const rangeFrom = useMemo(() => {
    const date = new Date()
    date.setDate(date.getDate() - days)
    return date.toISOString().slice(0, 10)
  }, [days])
  const query = useQuery({
    enabled: Boolean(connection && range) && isRouteActive,
    queryKey: ['usage', connection?.url, range],
    queryFn: async ({ signal }) => {
      const [daily, summary, stats] = await Promise.all([
        cradleRequest<GetUsageDailyResponse>(connection!, `/usage/daily?days=${days}`, { signal }),
        cradleRequest<GetUsageSummaryResponse>(connection!, `/usage/summary?from=${rangeFrom}`, {
          signal,
        }),
        cradleRequest<GetUsageStatsResponse>(connection!, '/usage/stats', { signal }),
      ])
      return { daily, stats, summary }
    },
  })

  useEffect(() => {
    let active = true
    void loadUsageRange().then((storedRange) => {
      if (active) {
        setRange(storedRange)
      }
    })
    return () => {
      active = false
    }
  }, [])

  const handleRangeChange = (nextRange: UsageRange) => {
    setRange(nextRange)
    void persistUsageRange(nextRange)
  }

  if (range === null || query.isPending) {
    return <LoadingState />
  }
  if (query.error) {
    return (
      <ErrorState
        title="Could not load Usage"
        description={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }
  return (
    <UsageView
      {...query.data}
      isRefreshing={query.isRefetching}
      onRangeChange={handleRangeChange}
      onRefresh={() => void query.refetch()}
      range={range}
    />
  )
}
