// Pure merge functions that fold every fleet device's usage series into one
// fleet-wide view. Additive measures (tokens, turns, cost, call counts) are
// summed; medians/percentiles are combined as sample-count-weighted averages
// — an approximation, since true cross-device percentiles would need raw
// samples the API doesn't expose.
import { usageStatsFromDaily } from './usage-insights'
import type {
  CostEfficiency,
  CostSummary,
  DailyCost,
  DailyUsage,
  DailyUsageByModel,
  HourlyUsage,
  RuntimePerformanceOverview,
  ToolUsageBreakdown,
  ToolUsageEntry,
  UsageStats,
  UsageSummary,
} from './use-usage-overview'

/** The full per-device series set the fleet merge consumes. */
export interface FleetMergeDevice {
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

export interface MergedFleetUsage {
  daily: DailyUsage[]
  dailyByModel: DailyUsageByModel[]
  dailyCost: DailyCost[]
  hourly: HourlyUsage[]
  costEfficiency: CostEfficiency[]
  summary: UsageSummary | null
  costSummary: CostSummary | null
  stats: UsageStats
  tools: ToolUsageBreakdown | null
  performance: RuntimePerformanceOverview | null
}

export function mergeFleetUsage(devices: FleetMergeDevice[]): MergedFleetUsage {
  const daily = mergeDaily(devices.flatMap(device => device.daily))
  return {
    daily,
    // Date×bucket rows are additive — concat and let consumers pivot.
    dailyByModel: devices.flatMap(device => device.dailyByModel),
    dailyCost: devices.flatMap(device => device.dailyCost),
    hourly: mergeHourly(devices.flatMap(device => device.hourly)),
    costEfficiency: mergeCostEfficiency(devices.flatMap(device => device.costEfficiency)),
    summary: mergeSummaries(devices.map(device => device.summary)),
    costSummary: mergeCostSummaries(devices.map(device => device.costSummary)),
    stats: usageStatsFromDaily(daily),
    tools: mergeTools(devices.map(device => device.tools)),
    performance: mergePerformance(devices.map(device => device.performance)),
  }
}

function mergeDaily(rows: DailyUsage[]): DailyUsage[] {
  const byDate = new Map<string, DailyUsage>()
  for (const row of rows) {
    const entry = byDate.get(row.date) ?? { date: row.date, promptTokens: 0, completionTokens: 0, totalTokens: 0, count: 0 }
    entry.promptTokens += row.promptTokens
    entry.completionTokens += row.completionTokens
    entry.totalTokens += row.totalTokens
    entry.count += row.count
    byDate.set(row.date, entry)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function mergeHourly(rows: HourlyUsage[]): HourlyUsage[] {
  const byHour = new Map<number, HourlyUsage>()
  for (const row of rows) {
    const entry = byHour.get(row.hour) ?? { hour: row.hour, promptTokens: 0, completionTokens: 0, totalTokens: 0, count: 0 }
    entry.promptTokens += row.promptTokens
    entry.completionTokens += row.completionTokens
    entry.totalTokens += row.totalTokens
    entry.count += row.count
    byHour.set(row.hour, entry)
  }
  return [...byHour.values()].sort((a, b) => a.hour - b.hour)
}

function mergeCostEfficiency(rows: CostEfficiency[]): CostEfficiency[] {
  const byDate = new Map<string, { totalTokens: number, runCount: number, totalCostUsd: number }>()
  for (const row of rows) {
    const entry = byDate.get(row.date) ?? { totalTokens: 0, runCount: 0, totalCostUsd: 0 }
    entry.totalTokens += row.totalTokens
    entry.runCount += row.runCount
    entry.totalCostUsd += row.totalCostUsd
    byDate.set(row.date, entry)
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, entry]) => ({
      date,
      totalTokens: entry.totalTokens,
      runCount: entry.runCount,
      avgTokensPerRun: entry.runCount > 0 ? Math.round(entry.totalTokens / entry.runCount) : 0,
      totalCostUsd: entry.totalCostUsd,
      avgCostPerRun: entry.runCount > 0 ? entry.totalCostUsd / entry.runCount : 0,
    }))
}

function mergeSummaries(summaries: Array<UsageSummary | null>): UsageSummary | null {
  const present = summaries.filter((summary): summary is UsageSummary => summary !== null)
  if (present.length === 0) {
    return null
  }
  return {
    totalPromptTokens: sum(present.map(s => s.totalPromptTokens)),
    totalCompletionTokens: sum(present.map(s => s.totalCompletionTokens)),
    totalTokens: sum(present.map(s => s.totalTokens)),
    totalTurns: sum(present.map(s => s.totalTurns)),
    byModel: mergeKeyed(present.flatMap(s => s.byModel), row => row.modelId),
    // Agent ids (codex/claude/...) are global runtime kinds, so merge by id.
    byAgent: mergeKeyed(present.flatMap(s => s.byAgent), row => row.agentId),
    // providerTargetId is a per-device database id; the display name is the
    // only stable cross-device key.
    byProviderTarget: mergeKeyed(
      present.flatMap(s => s.byProviderTarget),
      row => row.providerTargetName ?? row.providerTargetId,
    ),
  }
}

function mergeKeyed<Row extends { totalTokens: number, count: number }>(
  rows: Row[],
  keyOf: (row: Row) => string,
): Row[] {
  const byKey = new Map<string, Row>()
  for (const row of rows) {
    const key = keyOf(row)
    const entry = byKey.get(key)
    if (!entry) {
      byKey.set(key, { ...row })
    }
    else {
      entry.totalTokens += row.totalTokens
      entry.count += row.count
    }
  }
  return [...byKey.values()]
}

/** Numeric fields shared by all cost-summary breakdown rows (byModel / byAgent / byProviderTarget). */
interface CostBreakdownNumerics {
  totalTokens: number
  count: number
  costUsd: number
  promptTokens: number
  uncachedInputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  completionTokens: number
  uncachedInputCostUsd: number
  cacheReadCostUsd: number
  cacheWriteCostUsd: number
  outputCostUsd: number
}

const COST_NUMERIC_KEYS = [
  'totalTokens',
'count',
'costUsd',
  'promptTokens',
'uncachedInputTokens',
'cachedInputTokens',
'cacheWriteInputTokens',
'completionTokens',
  'uncachedInputCostUsd',
'cacheReadCostUsd',
'cacheWriteCostUsd',
'outputCostUsd',
] as const satisfies ReadonlyArray<keyof CostBreakdownNumerics>

function mergeCostBreakdownRows<Row extends CostBreakdownNumerics>(
  rows: Row[],
  keyOf: (row: Row) => string,
): Row[] {
  const byKey = new Map<string, Row>()
  for (const row of rows) {
    const key = keyOf(row)
    const entry = byKey.get(key)
    if (!entry) {
      byKey.set(key, { ...row })
    }
    else {
      for (const field of COST_NUMERIC_KEYS) {
        entry[field] += row[field]
      }
    }
  }
  return [...byKey.values()]
}

function mergeCostSummaries(summaries: Array<CostSummary | null>): CostSummary | null {
  const present = summaries.filter((summary): summary is CostSummary => summary !== null)
  if (present.length === 0) {
    return null
  }
  return {
    totalCostUsd: sum(present.map(s => s.totalCostUsd)),
    totalPromptTokens: sum(present.map(s => s.totalPromptTokens)),
    totalUncachedInputTokens: sum(present.map(s => s.totalUncachedInputTokens)),
    totalCachedInputTokens: sum(present.map(s => s.totalCachedInputTokens)),
    totalCacheWriteInputTokens: sum(present.map(s => s.totalCacheWriteInputTokens)),
    totalCompletionTokens: sum(present.map(s => s.totalCompletionTokens)),
    totalTokens: sum(present.map(s => s.totalTokens)),
    uncachedInputCostUsd: sum(present.map(s => s.uncachedInputCostUsd)),
    cacheReadCostUsd: sum(present.map(s => s.cacheReadCostUsd)),
    cacheWriteCostUsd: sum(present.map(s => s.cacheWriteCostUsd)),
    outputCostUsd: sum(present.map(s => s.outputCostUsd)),
    byModel: mergeCostBreakdownRows(present.flatMap(s => s.byModel), row => row.modelId),
    byAgent: mergeCostBreakdownRows(present.flatMap(s => s.byAgent), row => row.agentId),
    byProviderTarget: mergeCostBreakdownRows(
      present.flatMap(s => s.byProviderTarget),
      row => row.providerTargetName ?? row.providerTargetId,
    ),
  }
}

/** Count-weighted average; null entries contribute nothing. */
function weightedMean(values: Array<{ value: number | null, weight: number }>): number | null {
  const present = values.filter((entry): entry is { value: number, weight: number } => entry.value !== null && entry.weight > 0)
  if (present.length === 0) {
    return null
  }
  return sum(present.map(entry => entry.value * entry.weight)) / sum(present.map(entry => entry.weight))
}

function mergeToolEntries(rows: ToolUsageEntry[]): ToolUsageEntry[] {
  const byName = new Map<string, ToolUsageEntry>()
  for (const row of rows) {
    const entry = byName.get(row.toolName)
    if (!entry) {
      byName.set(row.toolName, { ...row })
    }
    else {
      entry.medianDurationMs = weightedMean([
        { value: entry.medianDurationMs, weight: entry.count },
        { value: row.medianDurationMs, weight: row.count },
      ])
      entry.count += row.count
      entry.successCount += row.successCount
      entry.failureCount += row.failureCount
      entry.deniedCount += row.deniedCount
      entry.interruptedCount += row.interruptedCount
    }
  }
  return [...byName.values()]
}

function mergeTools(tools: Array<ToolUsageBreakdown | null>): ToolUsageBreakdown | null {
  const present = tools.filter((entry): entry is ToolUsageBreakdown => entry !== null)
  if (present.length === 0) {
    return null
  }
  const overall = mergeToolEntries(present.flatMap(entry => entry.overall))
  const successCount = sum(overall.map(tool => tool.successCount))
  const failureCount = sum(overall.map(tool => tool.failureCount))
  const totalCalls = sum(overall.map(tool => tool.count))

  const byRuntimeKeys = [...new Set(present.flatMap(entry => entry.byRuntime.map(group => group.runtimeKind)))]
  const byModelKeys = [...new Set(present.flatMap(entry => entry.byModel.map(group => group.modelId)))]

  return {
    overall,
    byRuntime: byRuntimeKeys.map(runtimeKind => ({
      runtimeKind,
      tools: mergeToolEntries(present.flatMap(entry => entry.byRuntime.find(group => group.runtimeKind === runtimeKind)?.tools ?? [])),
    })),
    byModel: byModelKeys.map(modelId => ({
      modelId,
      tools: mergeToolEntries(present.flatMap(entry => entry.byModel.find(group => group.modelId === modelId)?.tools ?? [])),
    })),
    summary: {
      totalCalls,
      successCount,
      failureCount,
      deniedCount: sum(overall.map(tool => tool.deniedCount)),
      interruptedCount: sum(overall.map(tool => tool.interruptedCount)),
      successRatePct: successCount + failureCount > 0 ? (successCount / (successCount + failureCount)) * 100 : 0,
      uniqueToolCount: overall.length,
      medianDurationMs: weightedMean(present.map(entry => ({ value: entry.summary.medianDurationMs, weight: entry.summary.totalCalls }))),
    },
    daily: present.flatMap(entry => entry.daily),
    dailyByRuntime: present.flatMap(entry => entry.dailyByRuntime),
    dailyByModel: present.flatMap(entry => entry.dailyByModel),
  }
}

interface PerformanceSampleRow {
  sampleCount: number
  firstTokenSampleCount: number
  p50FirstTokenMs: number | null
  p95FirstTokenMs: number | null
  p50TotalDurationMs: number | null
  p95TotalDurationMs: number | null
}

function mergePerformanceSample<Row extends PerformanceSampleRow>(rows: Row[], init: Row): Row {
  const merged = { ...init }
  merged.sampleCount = sum(rows.map(row => row.sampleCount))
  merged.firstTokenSampleCount = sum(rows.map(row => row.firstTokenSampleCount))
  merged.p50FirstTokenMs = weightedMean(rows.map(row => ({ value: row.p50FirstTokenMs, weight: row.firstTokenSampleCount })))
  merged.p95FirstTokenMs = weightedMean(rows.map(row => ({ value: row.p95FirstTokenMs, weight: row.firstTokenSampleCount })))
  merged.p50TotalDurationMs = weightedMean(rows.map(row => ({ value: row.p50TotalDurationMs, weight: row.sampleCount })))
  merged.p95TotalDurationMs = weightedMean(rows.map(row => ({ value: row.p95TotalDurationMs, weight: row.sampleCount })))
  return merged
}

function mergePerformanceGroup<Row extends PerformanceSampleRow>(
  groups: Array<Row[]>,
  keyOf: (row: Row) => string,
  init: (first: Row) => Row,
): Row[] {
  const byKey = new Map<string, Row[]>()
  for (const row of groups.flat()) {
    const list = byKey.get(keyOf(row)) ?? []
    list.push(row)
    byKey.set(keyOf(row), list)
  }
  return Array.from(byKey.values(), rows => mergePerformanceSample(rows, init(rows[0])))
}

function mergePerformance(overviews: Array<RuntimePerformanceOverview | null>): RuntimePerformanceOverview | null {
  const present = overviews.filter((entry): entry is RuntimePerformanceOverview => entry !== null)
  if (present.length === 0) {
    return null
  }
  const coverageStarts = present.map(entry => entry.coverageStartedAt).filter((value): value is number => value !== null)
  const coverageEnds = present.map(entry => entry.coverageEndedAt).filter((value): value is number => value !== null)

  const dailyByKey = new Map<string, RuntimePerformanceOverview['daily']>()
  for (const row of present.flatMap(entry => entry.daily)) {
    const key = `${row.date}::${row.runtimeKind}`
    const list = dailyByKey.get(key) ?? []
    list.push(row)
    dailyByKey.set(key, list)
  }

  return {
    coverageStartedAt: coverageStarts.length > 0 ? Math.min(...coverageStarts) : null,
    coverageEndedAt: coverageEnds.length > 0 ? Math.max(...coverageEnds) : null,
    summary: mergePerformanceSample(present.map(entry => entry.summary), {
      sampleCount: 0,
      firstTokenSampleCount: 0,
      p50FirstTokenMs: null,
      p95FirstTokenMs: null,
      p50TotalDurationMs: null,
      p95TotalDurationMs: null,
    }),
    byRuntime: mergePerformanceGroup(
      present.map(entry => entry.byRuntime),
      row => row.runtimeKind,
      first => ({ runtimeKind: first.runtimeKind, sampleCount: 0, firstTokenSampleCount: 0, p50FirstTokenMs: null, p95FirstTokenMs: null, p50TotalDurationMs: null, p95TotalDurationMs: null }),
    ),
    byProviderTarget: mergePerformanceGroup(
      present.map(entry => entry.byProviderTarget),
      row => row.providerTargetName ?? row.providerTargetId ?? 'unknown',
      first => ({ providerTargetId: first.providerTargetId, providerTargetName: first.providerTargetName, sampleCount: 0, firstTokenSampleCount: 0, p50FirstTokenMs: null, p95FirstTokenMs: null, p50TotalDurationMs: null, p95TotalDurationMs: null }),
    ),
    byModel: mergePerformanceGroup(
      present.map(entry => entry.byModel),
      row => row.modelId,
      first => ({ modelId: first.modelId, sampleCount: 0, firstTokenSampleCount: 0, p50FirstTokenMs: null, p95FirstTokenMs: null, p50TotalDurationMs: null, p95TotalDurationMs: null }),
    ),
    daily: Array.from(dailyByKey.values(), rows => mergePerformanceSample(rows, {
        date: rows[0].date,
        runtimeKind: rows[0].runtimeKind,
        sampleCount: 0,
        firstTokenSampleCount: 0,
        p50FirstTokenMs: null,
        p95FirstTokenMs: null,
        p50TotalDurationMs: null,
        p95TotalDurationMs: null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.runtimeKind.localeCompare(b.runtimeKind)),
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
