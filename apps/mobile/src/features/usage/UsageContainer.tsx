import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Platform, Share } from 'react-native'

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
import { loadUsageRange, persistUsageRange } from './usage-range-storage'
import { createUsageReport } from './usage-view-model'
import { UsageView } from './UsageView'

export function UsageContainer() {
  const { connection } = useConnection()
  const isRouteActive = useRouteIsActive()
  const [range, setRange] = useState<UsageRange | null>(null)
  const [isSharing, setIsSharing] = useState(false)
  const days = usageRangeDays(range ?? '30d')
  const rangeFrom = useMemo(() => {
    const date = new Date()
    date.setDate(date.getDate() - days)
    return date.toISOString().slice(0, 10)
  }, [days])
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
  const query = useQuery({
    enabled: Boolean(connection) && isRouteActive && Boolean(range),
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

  if (!range || query.isPending) {
    return <LoadingState />
  }
  if (query.error) {
    return (
      <ErrorState
        title="Could not load Usage"
        description={errorMessage(query.error)}
        isActionPending={query.isFetching}
        onAction={() => { void query.refetch() }}
      />
    )
  }
  const shareUsage = async () => {
    if (isSharing) {
      return
    }
    setIsSharing(true)
    try {
      await Share.share({
        message: createUsageReport(range, query.data.summary, query.data.stats),
        title: 'Cradle Usage',
      })
    }
    catch {
      Alert.alert('Could not share Usage', 'The Usage snapshot could not be shared from this device.')
    }
    finally {
      setIsSharing(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Usage' }} />
      {Platform.OS === 'ios' && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            accessibilityHint="Opens the system share sheet with the selected Usage range"
            accessibilityLabel="Share Usage snapshot"
            disabled={isSharing}
            onPress={() => { void shareUsage() }}
          >
            <Stack.Toolbar.Icon sf="square.and.arrow.up" />
            <Stack.Toolbar.Label>{isSharing ? 'Preparing…' : 'Share'}</Stack.Toolbar.Label>
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <UsageView
        {...query.data}
        isRefreshing={query.isRefetching}
        onRangeChange={(nextRange) => {
          setRange(nextRange)
          void persistUsageRange(nextRange)
        }}
        onRefresh={async () => { await query.refetch() }}
        range={range}
      />
    </>
  )
}
