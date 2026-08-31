import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

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
import { usageRangeDays } from './usage-range'
import { UsageView } from './UsageView'

export function UsageContainer() {
  const { connection } = useConnection()
  const isRouteActive = useRouteIsActive()
  const [range, setRange] = useState<UsageRange>('30d')
  const days = usageRangeDays(range)
  const rangeFrom = useMemo(() => {
    const date = new Date()
    date.setDate(date.getDate() - days)
    return date.toISOString().slice(0, 10)
  }, [days])
  const query = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['usage', connection?.resourceId, range],
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

  if (query.isPending) {
    return <LoadingState />
  }
  if (query.error) {
    return <ErrorState title="Could not load Usage" description={errorMessage(query.error)} />
  }
  return (
    <UsageView
      {...query.data}
      isRefreshing={query.isRefetching}
      onRangeChange={setRange}
      onRefresh={() => void query.refetch()}
      range={range}
    />
  )
}
