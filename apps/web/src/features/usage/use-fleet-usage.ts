// Loads usage series from every online Fabric node via the upstream proxy and
// merges them with this device's local series into a FleetUsage model.
// Remote nodes expose the same Usage API (same server), so the generated
// response types are reused directly.
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  GetUsageCostDailyResponse,
  GetUsageDailyByModelResponse,
  GetUsageDailyResponse,
} from '~/api-gen/types.gen'
import { fetchNodeUpstreamJson, nodeUpstreamQueryKey } from '~/features/nodes/upstream-fetch'
import { useNodes } from '~/features/nodes/use-nodes'

import type { FleetDeviceUsage, FleetUsage } from './usage-fleet'
import { LOCAL_DEVICE_KEY } from './usage-fleet'
import type { DailyCost, DailyUsage, DailyUsageByModel } from './use-usage-overview'

interface LocalUsageSeries {
  daily: DailyUsage[]
  dailyByModel: DailyUsageByModel[]
  dailyCost: DailyCost[]
}

interface RemoteUsageSeries {
  daily: GetUsageDailyResponse
  dailyByModel: GetUsageDailyByModelResponse
  dailyCost: GetUsageCostDailyResponse
}

async function fetchRemoteUsageSeries(nodeId: string, signal: AbortSignal): Promise<RemoteUsageSeries> {
  const [daily, dailyByModel, dailyCost] = await Promise.all([
    fetchNodeUpstreamJson<GetUsageDailyResponse>(nodeId, '/usage/daily?days=365', { signal }),
    fetchNodeUpstreamJson<GetUsageDailyByModelResponse>(nodeId, '/usage/daily-by-model?days=365', { signal }),
    fetchNodeUpstreamJson<GetUsageCostDailyResponse>(nodeId, '/usage/cost/daily', { signal }),
  ])
  return { daily, dailyByModel, dailyCost }
}

/**
 * Returns `null` when this device has no Fabric nodes at all — callers then
 * render the single-device dashboard exactly as before.
 */
export function useFleetUsage(local: LocalUsageSeries, enabled: boolean): FleetUsage | null {
  const { t } = useTranslation('usage')
  const nodesQuery = useNodes(enabled)
  const nodes = useMemo(() => nodesQuery.data ?? [], [nodesQuery.data])
  const onlineNodes = useMemo(() => nodes.filter(node => node.status === 'online'), [nodes])

  const remoteQueries = useQueries({
    queries: onlineNodes.map(node => ({
      queryKey: nodeUpstreamQueryKey(node.nodeId, 'usage-fleet'),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchRemoteUsageSeries(node.nodeId, signal),
      staleTime: 60_000,
      // Offline links and missing grants are expected states surfaced in the
      // UI as unavailable devices, not worth retry storms.
      retry: false,
    })),
  })

  return useMemo(() => {
    if (!enabled || nodes.length === 0) {
      return null
    }

    const localDevice: FleetDeviceUsage = {
      key: LOCAL_DEVICE_KEY,
      label: t('device.thisDevice'),
      platform: null,
      isLocal: true,
      status: 'online',
      daily: local.daily,
      dailyByModel: local.dailyByModel,
      dailyCost: local.dailyCost,
    }

    const devices: FleetDeviceUsage[] = [localDevice]
    const unavailable: FleetUsage['unavailable'] = []
    let isLoading = false

    nodes.forEach((node) => {
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
        daily: query.data.daily,
        dailyByModel: query.data.dailyByModel,
        dailyCost: query.data.dailyCost,
      })
    })

    return { devices, unavailable, isLoading }
  }, [enabled, nodes, onlineNodes, remoteQueries, local, t])
}
