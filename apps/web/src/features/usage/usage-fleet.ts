// Fleet usage model: this device plus every reachable Fabric node, each
// carrying the same usage series so dashboard surfaces can stack, split, or
// merge by device. Remote series come from the node's own Usage API via the
// upstream proxy — the server never aggregates across devices, merging is a
// renderer concern (see usage-fleet-merge.ts).
import type { MergedFleetUsage } from './usage-fleet-merge'
import type {
  CostEfficiency,
  CostSummary,
  DailyCost,
  DailyUsage,
  DailyUsageByModel,
  HourlyUsage,
  RuntimePerformanceOverview,
  ToolUsageBreakdown,
  UsageSummary,
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
  hourly: HourlyUsage[]
  costEfficiency: CostEfficiency[]
  summary: UsageSummary | null
  costSummary: CostSummary | null
  tools: ToolUsageBreakdown | null
  performance: RuntimePerformanceOverview | null
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
  /** All devices folded into one fleet-wide view — what the dashboard renders when a Fabric exists. */
  merged: MergedFleetUsage
}
