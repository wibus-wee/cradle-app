// Loads the full usage surface from every remote online Fabric node via the upstream
// proxy and merges it with this device's local data into a FleetUsage model.
// Remote nodes expose the same Usage API (same server), so the generated
// response types are reused directly. Range-scoped endpoints (summary / cost
// summary / tools / performance) take the same `from` as the local queries so
// fleet rows line up; dense series use a fixed 365-day window and are sliced
// client-side like the local ones.
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  GetUsageCostDailyResponse,
  GetUsageCostEfficiencyResponse,
  GetUsageCostSummaryResponse,
  GetUsageDailyByModelResponse,
  GetUsageDailyResponse,
  GetUsagePatternsHourlyResponse,
  GetUsagePerformanceResponse,
  GetUsageSummaryResponse,
  GetUsageToolsResponse,
} from '~/api-gen/types.gen'
import type { FabricNode } from '~/features/nodes/types'
import { fetchNodeUpstreamJson, nodeUpstreamQueryKey } from '~/features/nodes/upstream-fetch'
import { useFabricMembership, useNodes } from '~/features/nodes/use-nodes'

import type { FleetDeviceUsage, FleetUsage } from './usage-fleet'
import { LOCAL_DEVICE_KEY } from './usage-fleet'
import type { FleetMergeDevice } from './usage-fleet-merge'
import { mergeFleetUsage } from './usage-fleet-merge'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'

type LocalUsageSeries = FleetMergeDevice

interface RemoteUsageSeries {
  daily: GetUsageDailyResponse
  dailyByModel: GetUsageDailyByModelResponse
  dailyCost: GetUsageCostDailyResponse
  hourly: GetUsagePatternsHourlyResponse
  costEfficiency: GetUsageCostEfficiencyResponse
  summary: GetUsageSummaryResponse
  costSummary: GetUsageCostSummaryResponse
  tools: GetUsageToolsResponse
  performance: GetUsagePerformanceResponse
}

/** A Fabric directory includes this device; its usage is already supplied locally. */
export function remoteFleetNodes(nodes: readonly FabricNode[], localNodeId: string | null | undefined): FabricNode[] {
  return localNodeId ? nodes.filter(node => node.nodeId !== localNodeId) : []
}

async function fetchRemoteUsageSeries(nodeId: string, from: string, signal: AbortSignal): Promise<RemoteUsageSeries> {
  const [daily, dailyByModel, dailyCost, hourly, costEfficiency, summary, costSummary, tools, performance] = await Promise.all([
    fetchNodeUpstreamJson<GetUsageDailyResponse>(nodeId, '/usage/daily?days=365', { signal }),
    fetchNodeUpstreamJson<GetUsageDailyByModelResponse>(nodeId, '/usage/daily-by-model?days=365', { signal }),
    fetchNodeUpstreamJson<GetUsageCostDailyResponse>(nodeId, '/usage/cost/daily', { signal }),
    fetchNodeUpstreamJson<GetUsagePatternsHourlyResponse>(nodeId, '/usage/patterns/hourly', { signal }),
    fetchNodeUpstreamJson<GetUsageCostEfficiencyResponse>(nodeId, '/usage/cost-efficiency?days=365', { signal }),
    fetchNodeUpstreamJson<GetUsageSummaryResponse>(nodeId, `/usage/summary?from=${from}`, { signal }),
    fetchNodeUpstreamJson<GetUsageCostSummaryResponse>(nodeId, `/usage/cost/summary?from=${from}`, { signal }),
    fetchNodeUpstreamJson<GetUsageToolsResponse>(nodeId, `/usage/tools?from=${from}`, { signal }),
    fetchNodeUpstreamJson<GetUsagePerformanceResponse>(nodeId, `/usage/performance?from=${from}`, { signal }),
  ])
  return { daily, dailyByModel, dailyCost, hourly, costEfficiency, summary, costSummary, tools, performance }
}

/**
 * Returns `null` when this device has no Fabric nodes at all — callers then
 * render the single-device dashboard exactly as before. Remote series fill in
 * progressively: a node still loading simply isn't part of `devices`/`merged`
 * yet (isLoading signals that state).
 */
export function useFleetUsage(local: LocalUsageSeries, range: UsageRangeKey, enabled: boolean): FleetUsage | null {
  const { t } = useTranslation('usage')
  const membershipQuery = useFabricMembership(enabled)
  const nodesQuery = useNodes(enabled)
  const nodes = useMemo(() => nodesQuery.data ?? [], [nodesQuery.data])
  const localNodeId = membershipQuery.data?.localNodeId
  const remoteNodes = useMemo(
    () => remoteFleetNodes(nodes, localNodeId),
    [localNodeId, nodes],
  )
  const onlineNodes = useMemo(() => remoteNodes.filter(node => node.status === 'online'), [remoteNodes])

  // Same rangeFrom contract as useUsageOverview (bare YYYY-MM-DD date).
  const rangeFrom = useMemo(() => {
    const date = new Date()
    date.setDate(date.getDate() - rangeDays(range))
    return date.toISOString().slice(0, 10)
  }, [range])

  const remoteQueries = useQueries({
    queries: onlineNodes.map(node => ({
      queryKey: nodeUpstreamQueryKey(node.nodeId, 'usage-fleet', rangeFrom),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchRemoteUsageSeries(node.nodeId, rangeFrom, signal),
      staleTime: 60_000,
      // Offline links and missing grants are expected states surfaced in the
      // UI as unavailable devices, not worth retry storms.
      retry: false,
    })),
  })

  return useMemo(() => {
    if (!enabled || !localNodeId || remoteNodes.length === 0) {
      return null
    }

    const localDevice: FleetDeviceUsage = {
      key: LOCAL_DEVICE_KEY,
      label: t('device.thisDevice'),
      platform: null,
      isLocal: true,
      status: 'online',
      ...local,
    }

    const devices: FleetDeviceUsage[] = [localDevice]
    const unavailable: FleetUsage['unavailable'] = []
    let isLoading = false

    remoteNodes.forEach((node) => {
      if (node.status !== 'online') {
        unavailable.push({ key: node.nodeId, label: node.displayName, platform: node.platform, status: 'offline' })
        return
      }
      const query = remoteQueries[onlineNodes.findIndex(online => online.nodeId === node.nodeId)]
      if (!query) {
        return
      }
      if (query.isPending) {
        isLoading = true
        return
      }
      if (query.isError || !query.data) {
        unavailable.push({ key: node.nodeId, label: node.displayName, platform: node.platform, status: 'error' })
        return
      }
      devices.push({
        key: node.nodeId,
        label: node.displayName,
        platform: node.platform,
        isLocal: false,
        status: 'online',
        ...query.data,
      })
    })

    return { devices, unavailable, isLoading, merged: mergeFleetUsage(devices) }
  }, [enabled, localNodeId, remoteNodes, onlineNodes, remoteQueries, local, t])
}
