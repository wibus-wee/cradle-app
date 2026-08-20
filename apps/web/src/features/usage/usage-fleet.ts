// Fleet usage model: this device plus every reachable Fabric node, each
// carrying the same daily usage series so dashboard surfaces can stack or
// split by device. Remote series come from the node's own Usage API via the
// upstream proxy — the server never aggregates across devices, merging is a
// renderer concern.
import type {
  DailyCost,
  DailyUsage,
  DailyUsageByModel,
} from './use-usage-overview'

export const LOCAL_DEVICE_KEY = 'local'

export interface FleetDeviceUsage {
  /** 'local' for this device, otherwise the Fabric nodeId. */
  key: string
  label: string
  platform: string | null
  isLocal: boolean
  status: 'online' | 'offline' | 'error'
  daily: DailyUsage[]
  dailyByModel: DailyUsageByModel[]
  dailyCost: DailyCost[]
}

export interface FleetUnavailableDevice {
  key: string
  label: string
  platform: string | null
  /** offline = node itself is down; error = reachable but usage read failed (e.g. missing grant). */
  status: 'offline' | 'error'
}

export interface FleetUsage {
  /** Local device first, then reachable remote nodes (usage series loaded). */
  devices: FleetDeviceUsage[]
  /** Nodes that are part of the Fabric but contributed no series. */
  unavailable: FleetUnavailableDevice[]
  /** True while any remote node's usage query is still in flight. */
  isLoading: boolean
}
