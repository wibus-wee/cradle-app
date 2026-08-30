import type { UsageDashboardViewProps } from '../usage-dashboard-view'
import type { FleetDeviceUsage } from '../usage-fleet'
import { LOCAL_DEVICE_KEY } from '../usage-fleet'
import { mergeFleetUsage } from '../usage-fleet-merge'
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
  UsageSummary,
} from '../use-usage-overview'

const MODEL_SPLIT = [
  { id: 'gpt-5.2', share: 0.48 },
  { id: 'claude-opus-4.6', share: 0.34 },
  { id: 'gemini-3-pro', share: 0.18 },
] as const

function dateKey(daysAgo: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

const daily: DailyUsage[] = Array.from({ length: 96 }, (_, index) => {
  const daysAgo = 95 - index
  const weekday = new Date(`${dateKey(daysAgo)}T12:00:00`).getDay()
  const active = ![0, 6].includes(weekday) || index % 3 === 0
  const totalTokens = active ? 84_000 + ((index * 37_000) % 410_000) : 0
  return {
    date: dateKey(daysAgo),
    promptTokens: Math.round(totalTokens * 0.76),
    completionTokens: Math.round(totalTokens * 0.24),
    totalTokens,
    count: totalTokens > 0 ? 4 + (index % 19) : 0,
  }
})

const dailyByModel: DailyUsageByModel[] = daily.flatMap((entry, dayIndex) =>
  MODEL_SPLIT.map((model, modelIndex) => ({
    date: entry.date,
    modelId: model.id,
    totalTokens: Math.round(entry.totalTokens * model.share),
    count: entry.count > 0 ? Math.max(1, Math.round(entry.count * model.share) + ((dayIndex + modelIndex) % 2)) : 0,
  })))

const dailyCost: DailyCost[] = dailyByModel.map((entry) => {
  const promptTokens = Math.round(entry.totalTokens * 0.76)
  const completionTokens = entry.totalTokens - promptTokens
  const cachedInputTokens = Math.round(promptTokens * 0.4)
  const cacheWriteInputTokens = Math.round(promptTokens * 0.05)
  const uncachedInputTokens = promptTokens - cachedInputTokens - cacheWriteInputTokens
  const inputRate = entry.modelId.startsWith('claude') ? 6 : entry.modelId.startsWith('gpt') ? 4 : 2.5
  const outputRate = inputRate * 3
  const uncachedInputCostUsd = uncachedInputTokens * inputRate / 1_000_000
  const cacheReadCostUsd = cachedInputTokens * inputRate * 0.1 / 1_000_000
  const cacheWriteCostUsd = cacheWriteInputTokens * inputRate * 1.25 / 1_000_000
  const outputCostUsd = completionTokens * outputRate / 1_000_000
  return {
    date: entry.date,
    modelId: entry.modelId,
    costUsd: uncachedInputCostUsd + cacheReadCostUsd + cacheWriteCostUsd + outputCostUsd,
    promptTokens,
    uncachedInputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    completionTokens,
    totalTokens: entry.totalTokens,
    uncachedInputCostUsd,
    cacheReadCostUsd,
    cacheWriteCostUsd,
    outputCostUsd,
    stepCount: entry.count,
  }
})

const hourly: HourlyUsage[] = Array.from({ length: 24 }, (_, hour) => {
  const totalTokens = hour >= 9 && hour <= 22
    ? 130_000 + Math.round(Math.sin((hour - 9) / 13 * Math.PI) * 720_000)
    : 18_000 + hour * 2_400
  return {
    hour,
    promptTokens: Math.round(totalTokens * 0.76),
    completionTokens: Math.round(totalTokens * 0.24),
    totalTokens,
    count: Math.max(1, Math.round(totalTokens / 52_000)),
  }
})

const modelTotals = MODEL_SPLIT.map(model => ({
  modelId: model.id,
  totalTokens: dailyByModel
    .filter(entry => entry.modelId === model.id)
    .reduce((sum, entry) => sum + entry.totalTokens, 0),
  count: dailyByModel
    .filter(entry => entry.modelId === model.id)
    .reduce((sum, entry) => sum + entry.count, 0),
}))

const totalTokens = daily.reduce((sum, entry) => sum + entry.totalTokens, 0)
const totalTurns = daily.reduce((sum, entry) => sum + entry.count, 0)

const summary: UsageSummary = {
  totalPromptTokens: Math.round(totalTokens * 0.76),
  totalCompletionTokens: Math.round(totalTokens * 0.24),
  totalTokens,
  totalTurns,
  byModel: modelTotals,
  byAgent: [
    { agentId: 'codex', agentName: 'Codex', totalTokens: Math.round(totalTokens * 0.58), count: Math.round(totalTurns * 0.58) },
    { agentId: 'claude', agentName: 'Claude Agent', totalTokens: Math.round(totalTokens * 0.29), count: Math.round(totalTurns * 0.29) },
    { agentId: 'kimi', agentName: 'Kimi', totalTokens: Math.round(totalTokens * 0.13), count: Math.round(totalTurns * 0.13) },
  ],
  byProviderTarget: [
    { providerTargetId: 'openai', providerTargetName: 'OpenAI', totalTokens: Math.round(totalTokens * 0.48), count: Math.round(totalTurns * 0.48) },
    { providerTargetId: 'anthropic', providerTargetName: 'Anthropic', totalTokens: Math.round(totalTokens * 0.34), count: Math.round(totalTurns * 0.34) },
    { providerTargetId: 'google', providerTargetName: 'Google AI', totalTokens: Math.round(totalTokens * 0.18), count: Math.round(totalTurns * 0.18) },
  ],
}

const costByModel = modelTotals.map((model) => {
  const entries = dailyCost.filter(entry => entry.modelId === model.modelId)
  return {
    ...model,
    costUsd: entries.reduce((sum, entry) => sum + entry.costUsd, 0),
    promptTokens: entries.reduce((sum, entry) => sum + entry.promptTokens, 0),
    uncachedInputTokens: entries.reduce((sum, entry) => sum + entry.uncachedInputTokens, 0),
    cachedInputTokens: entries.reduce((sum, entry) => sum + entry.cachedInputTokens, 0),
    cacheWriteInputTokens: entries.reduce((sum, entry) => sum + entry.cacheWriteInputTokens, 0),
    completionTokens: entries.reduce((sum, entry) => sum + entry.completionTokens, 0),
    uncachedInputCostUsd: entries.reduce((sum, entry) => sum + entry.uncachedInputCostUsd, 0),
    cacheReadCostUsd: entries.reduce((sum, entry) => sum + entry.cacheReadCostUsd, 0),
    cacheWriteCostUsd: entries.reduce((sum, entry) => sum + entry.cacheWriteCostUsd, 0),
    outputCostUsd: entries.reduce((sum, entry) => sum + entry.outputCostUsd, 0),
  }
})

const totalCostUsd = costByModel.reduce((sum, entry) => sum + entry.costUsd, 0)
const totalUncachedInputTokens = costByModel.reduce((sum, entry) => sum + entry.uncachedInputTokens, 0)
const totalCachedInputTokens = costByModel.reduce((sum, entry) => sum + entry.cachedInputTokens, 0)
const totalCacheWriteInputTokens = costByModel.reduce((sum, entry) => sum + entry.cacheWriteInputTokens, 0)
const uncachedInputCostUsd = costByModel.reduce((sum, entry) => sum + entry.uncachedInputCostUsd, 0)
const cacheReadCostUsd = costByModel.reduce((sum, entry) => sum + entry.cacheReadCostUsd, 0)
const cacheWriteCostUsd = costByModel.reduce((sum, entry) => sum + entry.cacheWriteCostUsd, 0)
const outputCostUsd = costByModel.reduce((sum, entry) => sum + entry.outputCostUsd, 0)

function scaledCostBreakdown(share: number) {
  return {
    costUsd: totalCostUsd * share,
    promptTokens: Math.round(summary.totalPromptTokens * share),
    uncachedInputTokens: Math.round(totalUncachedInputTokens * share),
    cachedInputTokens: Math.round(totalCachedInputTokens * share),
    cacheWriteInputTokens: Math.round(totalCacheWriteInputTokens * share),
    completionTokens: Math.round(summary.totalCompletionTokens * share),
    uncachedInputCostUsd: uncachedInputCostUsd * share,
    cacheReadCostUsd: cacheReadCostUsd * share,
    cacheWriteCostUsd: cacheWriteCostUsd * share,
    outputCostUsd: outputCostUsd * share,
  }
}

const costSummary: CostSummary = {
  totalCostUsd,
  totalPromptTokens: summary.totalPromptTokens,
  totalUncachedInputTokens,
  totalCachedInputTokens,
  totalCacheWriteInputTokens,
  totalCompletionTokens: summary.totalCompletionTokens,
  totalTokens,
  uncachedInputCostUsd,
  cacheReadCostUsd,
  cacheWriteCostUsd,
  outputCostUsd,
  byModel: costByModel,
  byAgent: summary.byAgent.map((agent, index) => ({
    ...agent,
    ...scaledCostBreakdown([0.58, 0.29, 0.13][index]),
  })),
  byProviderTarget: summary.byProviderTarget.map((provider, index) => ({
    ...provider,
    ...scaledCostBreakdown([0.48, 0.34, 0.18][index]),
  })),
}

const performanceDaily: RuntimePerformanceOverview['daily'] = daily
  .slice(-30)
  .flatMap((entry, index) => {
    if (entry.count === 0) {
      return []
    }
    return [
      {
        date: entry.date,
        runtimeKind: 'codex',
        sampleCount: 5 + (index % 6),
        firstTokenSampleCount: 5 + (index % 6),
        p50FirstTokenMs: 620 + ((index * 37) % 280),
        p95FirstTokenMs: 1_350 + ((index * 53) % 620),
        p50TotalDurationMs: 18_000 + ((index * 1_700) % 15_000),
        p95TotalDurationMs: 48_000 + ((index * 2_900) % 32_000),
      },
      {
        date: entry.date,
        runtimeKind: 'claude-agent',
        sampleCount: 3 + (index % 5),
        firstTokenSampleCount: 3 + (index % 5),
        p50FirstTokenMs: 780 + ((index * 41) % 360),
        p95FirstTokenMs: 1_700 + ((index * 67) % 760),
        p50TotalDurationMs: 21_000 + ((index * 1_900) % 17_000),
        p95TotalDurationMs: 55_000 + ((index * 3_100) % 37_000),
      },
      {
        date: entry.date,
        runtimeKind: 'kimi',
        sampleCount: 2 + (index % 4),
        firstTokenSampleCount: index % 4 === 0 ? 1 + (index % 3) : 2 + (index % 4),
        p50FirstTokenMs: 540 + ((index * 29) % 240),
        p95FirstTokenMs: 1_100 + ((index * 47) % 480),
        p50TotalDurationMs: 16_000 + ((index * 1_300) % 13_000),
        p95TotalDurationMs: 43_000 + ((index * 2_300) % 29_000),
      },
    ]
  })

const runtimePerformance: RuntimePerformanceOverview = {
  coverageStartedAt: new Date(`${daily.at(-30)!.date}T09:15:00`).getTime(),
  coverageEndedAt: new Date(`${daily.at(-1)!.date}T19:42:00`).getTime(),
  summary: {
    sampleCount: 318,
    firstTokenSampleCount: 306,
    p50FirstTokenMs: 710,
    p95FirstTokenMs: 1_820,
    p50TotalDurationMs: 23_400,
    p95TotalDurationMs: 71_600,
  },
  byRuntime: [
    { runtimeKind: 'codex', sampleCount: 151, firstTokenSampleCount: 151, p50FirstTokenMs: 690, p95FirstTokenMs: 1_730, p50TotalDurationMs: 22_100, p95TotalDurationMs: 68_400 },
    { runtimeKind: 'claude-agent', sampleCount: 103, firstTokenSampleCount: 103, p50FirstTokenMs: 850, p95FirstTokenMs: 2_140, p50TotalDurationMs: 27_800, p95TotalDurationMs: 79_200 },
    { runtimeKind: 'kimi', sampleCount: 64, firstTokenSampleCount: 52, p50FirstTokenMs: 580, p95FirstTokenMs: 1_390, p50TotalDurationMs: 18_700, p95TotalDurationMs: 61_500 },
  ],
  byProviderTarget: [],
  byModel: [],
  daily: performanceDaily,
}

const toolOverall = [
  { toolName: 'Read', count: 1240, successCount: 1228, failureCount: 8, deniedCount: 2, interruptedCount: 2, medianDurationMs: 45 },
  { toolName: 'Edit', count: 890, successCount: 878, failureCount: 10, deniedCount: 0, interruptedCount: 2, medianDurationMs: 120 },
  { toolName: 'Write', count: 450, successCount: 444, failureCount: 5, deniedCount: 0, interruptedCount: 1, medianDurationMs: 80 },
  { toolName: 'Bash', count: 320, successCount: 296, failureCount: 18, deniedCount: 2, interruptedCount: 4, medianDurationMs: 2500 },
  { toolName: 'Grep', count: 280, successCount: 279, failureCount: 0, deniedCount: 0, interruptedCount: 1, medianDurationMs: 30 },
  { toolName: 'Glob', count: 190, successCount: 190, failureCount: 0, deniedCount: 0, interruptedCount: 0, medianDurationMs: 25 },
  { toolName: 'Agent', count: 96, successCount: 90, failureCount: 4, deniedCount: 0, interruptedCount: 2, medianDurationMs: 48_000 },
]

const toolTotals = toolOverall.reduce(
  (acc, tool) => ({
    totalCalls: acc.totalCalls + tool.count,
    successCount: acc.successCount + tool.successCount,
    failureCount: acc.failureCount + tool.failureCount,
    deniedCount: acc.deniedCount + tool.deniedCount,
    interruptedCount: acc.interruptedCount + tool.interruptedCount,
  }),
  { totalCalls: 0, successCount: 0, failureCount: 0, deniedCount: 0, interruptedCount: 0 },
)

const toolDaily = daily.flatMap((entry, dayIndex) => {
  if (entry.count === 0) { return [] }
  const dayTotal = 12 + ((dayIndex * 29) % 160)
  return toolOverall.slice(0, 6).map((tool, toolIndex) => ({
    date: entry.date,
    toolName: tool.toolName,
    count: Math.max(1, Math.round(dayTotal * [0.32, 0.24, 0.16, 0.12, 0.09, 0.07][toolIndex])),
  }))
})

const tools: ToolUsageBreakdown = {
  summary: {
    ...toolTotals,
    successRatePct: (toolTotals.successCount / (toolTotals.successCount + toolTotals.failureCount)) * 100,
    uniqueToolCount: toolOverall.length,
    medianDurationMs: 820,
  },
  daily: toolDaily,
  dailyByRuntime: toolDaily.flatMap(row => [
    { date: row.date, runtimeKind: 'opencode', toolName: row.toolName, count: Math.ceil(row.count * 0.6) },
    { date: row.date, runtimeKind: 'codex', toolName: row.toolName, count: Math.floor(row.count * 0.4) },
  ]),
  dailyByModel: toolDaily.flatMap(row => [
    { date: row.date, modelId: 'gpt-5.2', toolName: row.toolName, count: Math.ceil(row.count * 0.55) },
    { date: row.date, modelId: 'claude-opus-4.6', toolName: row.toolName, count: Math.floor(row.count * 0.45) },
  ]),
  overall: toolOverall,
  byRuntime: [
    { runtimeKind: 'opencode', tools: [
      { toolName: 'Read', count: 800, successCount: 793, failureCount: 5, deniedCount: 0, interruptedCount: 2, medianDurationMs: 40 },
      { toolName: 'Edit', count: 600, successCount: 593, failureCount: 5, deniedCount: 0, interruptedCount: 2, medianDurationMs: 110 },
    ]},
    { runtimeKind: 'codex', tools: [
      { toolName: 'Read', count: 440, successCount: 435, failureCount: 3, deniedCount: 2, interruptedCount: 0, medianDurationMs: 55 },
      { toolName: 'Edit', count: 290, successCount: 285, failureCount: 5, deniedCount: 0, interruptedCount: 0, medianDurationMs: 135 },
    ]},
  ],
  byModel: [
    { modelId: 'gpt-5.2', tools: [
      { toolName: 'Read', count: 600, successCount: 594, failureCount: 5, deniedCount: 0, interruptedCount: 1, medianDurationMs: 42 },
      { toolName: 'Edit', count: 420, successCount: 414, failureCount: 5, deniedCount: 0, interruptedCount: 1, medianDurationMs: 115 },
    ]},
    { modelId: 'claude-opus-4.6', tools: [
      { toolName: 'Read', count: 420, successCount: 417, failureCount: 2, deniedCount: 0, interruptedCount: 1, medianDurationMs: 48 },
      { toolName: 'Edit', count: 310, successCount: 307, failureCount: 2, deniedCount: 0, interruptedCount: 1, medianDurationMs: 125 },
    ]},
  ],
}

const costEfficiency: CostEfficiency[] = daily.slice(-30).map(entry => ({
  date: entry.date,
  totalTokens: entry.totalTokens,
  runCount: entry.count,
  avgTokensPerRun: entry.count > 0 ? Math.round(entry.totalTokens / entry.count) : 0,
  totalCostUsd: dailyCost.filter(c => c.date === entry.date).reduce((sum, c) => sum + c.costUsd, 0),
  avgCostPerRun: entry.count > 0 ? dailyCost.filter(c => c.date === entry.date).reduce((sum, c) => sum + c.costUsd, 0) / entry.count : 0,
}))

// Fleet fixture: this device plus two reachable remote nodes (scaled copies of
// the local series so shares differ per device) and one offline node.
function scaledDaily(scale: number, phase: number): DailyUsage[] {
  return daily.map((entry, index) => ({
    ...entry,
    totalTokens: Math.round(entry.totalTokens * scale * (1 + ((index + phase) % 5) * 0.08)),
    count: Math.round(entry.count * scale),
  }))
}

function scaledDailyByModel(scale: number, phase: number): DailyUsageByModel[] {
  return dailyByModel.map((entry, index) => ({
    ...entry,
    totalTokens: Math.round(entry.totalTokens * scale * (1 + ((index + phase) % 5) * 0.08)),
    count: Math.max(1, Math.round(entry.count * scale)),
  }))
}

function scaledDailyCost(scale: number, phase: number): DailyCost[] {
  return dailyCost.map((entry, index) => ({
    ...entry,
    costUsd: entry.costUsd * scale * (1 + ((index + phase) % 5) * 0.08),
  }))
}

function scaledHourly(scale: number): HourlyUsage[] {
  return hourly.map(entry => ({
    ...entry,
    promptTokens: Math.round(entry.promptTokens * scale),
    completionTokens: Math.round(entry.completionTokens * scale),
    totalTokens: Math.round(entry.totalTokens * scale),
    count: Math.max(1, Math.round(entry.count * scale)),
  }))
}

function scaledSummary(scale: number): UsageSummary {
  const scaleRows = <Row extends { totalTokens: number, count: number }>(rows: Row[]): Row[] =>
    rows.map(row => ({ ...row, totalTokens: Math.round(row.totalTokens * scale), count: Math.max(1, Math.round(row.count * scale)) }))
  return {
    totalPromptTokens: Math.round(summary.totalPromptTokens * scale),
    totalCompletionTokens: Math.round(summary.totalCompletionTokens * scale),
    totalTokens: Math.round(summary.totalTokens * scale),
    totalTurns: Math.round(summary.totalTurns * scale),
    byModel: scaleRows(summary.byModel),
    byAgent: scaleRows(summary.byAgent),
    byProviderTarget: scaleRows(summary.byProviderTarget),
  }
}

function scaledCostSummary(scale: number): CostSummary {
  const scaleCostRows = <Row extends { totalTokens: number, count: number, costUsd: number }>(rows: Row[]): Row[] =>
    rows.map(row => ({ ...row, totalTokens: Math.round(row.totalTokens * scale), count: Math.max(1, Math.round(row.count * scale)), costUsd: row.costUsd * scale }))
  return {
    ...costSummary,
    totalCostUsd: costSummary.totalCostUsd * scale,
    totalPromptTokens: Math.round(costSummary.totalPromptTokens * scale),
    totalUncachedInputTokens: Math.round(costSummary.totalUncachedInputTokens * scale),
    totalCachedInputTokens: Math.round(costSummary.totalCachedInputTokens * scale),
    totalCacheWriteInputTokens: Math.round(costSummary.totalCacheWriteInputTokens * scale),
    totalCompletionTokens: Math.round(costSummary.totalCompletionTokens * scale),
    totalTokens: Math.round(costSummary.totalTokens * scale),
    uncachedInputCostUsd: costSummary.uncachedInputCostUsd * scale,
    cacheReadCostUsd: costSummary.cacheReadCostUsd * scale,
    cacheWriteCostUsd: costSummary.cacheWriteCostUsd * scale,
    outputCostUsd: costSummary.outputCostUsd * scale,
    byModel: scaleCostRows(costSummary.byModel),
    byAgent: scaleCostRows(costSummary.byAgent),
    byProviderTarget: scaleCostRows(costSummary.byProviderTarget),
  }
}

function scaledTools(scale: number): ToolUsageBreakdown {
  const scaleOutcomes = <Row extends { successCount: number, failureCount: number, deniedCount: number, interruptedCount: number }>(row: Row): Row => ({
    ...row,
    successCount: Math.max(1, Math.round(row.successCount * scale)),
    failureCount: Math.round(row.failureCount * scale),
    deniedCount: Math.round(row.deniedCount * scale),
    interruptedCount: Math.round(row.interruptedCount * scale),
  })
  const scaleTool = (row: ToolUsageEntry): ToolUsageEntry => ({
    ...scaleOutcomes(row),
    count: Math.max(1, Math.round(row.count * scale)),
  })
  return {
    summary: { ...scaleOutcomes(tools.summary), totalCalls: Math.max(1, Math.round(tools.summary.totalCalls * scale)) },
    overall: tools.overall.map(scaleTool),
    byRuntime: tools.byRuntime.map(group => ({ ...group, tools: group.tools.map(scaleTool) })),
    byModel: tools.byModel.map(group => ({ ...group, tools: group.tools.map(scaleTool) })),
    daily: tools.daily.map(row => ({ ...row, count: Math.max(1, Math.round(row.count * scale)) })),
    dailyByRuntime: tools.dailyByRuntime.map(row => ({ ...row, count: Math.max(1, Math.round(row.count * scale)) })),
    dailyByModel: tools.dailyByModel.map(row => ({ ...row, count: Math.max(1, Math.round(row.count * scale)) })),
  }
}

function scaledCostEfficiency(scale: number): CostEfficiency[] {
  return costEfficiency.map(entry => ({
    ...entry,
    totalTokens: Math.round(entry.totalTokens * scale),
    runCount: Math.max(1, Math.round(entry.runCount * scale)),
    totalCostUsd: entry.totalCostUsd * scale,
    avgCostPerRun: entry.avgCostPerRun,
    avgTokensPerRun: entry.avgTokensPerRun,
  }))
}

function scaledPerformance(scale: number): RuntimePerformanceOverview {
  const scaleSample = <Row extends { sampleCount: number, firstTokenSampleCount: number }>(row: Row): Row => ({
    ...row,
    sampleCount: Math.max(1, Math.round(row.sampleCount * scale)),
    firstTokenSampleCount: Math.max(1, Math.round(row.firstTokenSampleCount * scale)),
  })
  return {
    ...runtimePerformance,
    summary: scaleSample(runtimePerformance.summary),
    byRuntime: runtimePerformance.byRuntime.map(scaleSample),
    byProviderTarget: runtimePerformance.byProviderTarget.map(scaleSample),
    byModel: runtimePerformance.byModel.map(scaleSample),
    daily: runtimePerformance.daily.map(scaleSample),
  }
}

function remoteDevice(key: string, label: string, platform: string, scale: number, phase: number): FleetDeviceUsage {
  return {
    key,
    label,
    platform,
    isLocal: false,
    status: 'online',
    daily: scaledDaily(scale, phase),
    dailyByModel: scaledDailyByModel(scale, phase),
    dailyCost: scaledDailyCost(scale, phase),
    hourly: scaledHourly(scale),
    costEfficiency: scaledCostEfficiency(scale),
    summary: scaledSummary(scale),
    costSummary: scaledCostSummary(scale),
    tools: scaledTools(scale),
    performance: scaledPerformance(scale),
  }
}

const fleetDevices: FleetDeviceUsage[] = [
  {
    key: LOCAL_DEVICE_KEY,
    label: '本机',
    platform: null,
    isLocal: true,
    status: 'online',
    daily,
    dailyByModel,
    dailyCost,
    hourly,
    costEfficiency,
    summary,
    costSummary,
    tools,
    performance: runtimePerformance,
  },
  remoteDevice('node-macbook', 'MacBook Pro', 'darwin', 0.35, 1),
  remoteDevice('node-devbox', 'Dev Box', 'linux', 0.18, 3),
]

const fleetMerged = mergeFleetUsage(fleetDevices)

const fleet: UsageDashboardViewProps['fleet'] = {
  devices: fleetDevices,
  unavailable: [
    { key: 'node-nas', label: 'Home NAS', platform: 'linux', status: 'offline' },
  ],
  isLoading: false,
  merged: fleetMerged,
}

// The View receives what the container would send in production: with a
// Fabric fleet every surface gets the merged fleet-wide series.
export const populatedUsageDashboardFixture: UsageDashboardViewProps = {
  daily: fleetMerged.daily,
  dailyByModel: fleetMerged.dailyByModel,
  hourly: fleetMerged.hourly,
  summary: fleetMerged.summary,
  stats: fleetMerged.stats,
  costSummary: fleetMerged.costSummary,
  dailyCost: fleetMerged.dailyCost,
  tools: fleetMerged.tools,
  costEfficiency: fleetMerged.costEfficiency,
  performance: fleetMerged.performance,
  fleet,
  usageReady: true,
  range: '30d',
  onRangeChange: () => {},
  onExport: () => {},
  themeMode: 'light',
}

export const emptyUsageDashboardFixture: UsageDashboardViewProps = {
  daily: [],
  dailyByModel: [],
  hourly: [],
  summary: {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalTurns: 0,
    byAgent: [],
    byProviderTarget: [],
    byModel: [],
  },
  stats: {
    currentStreak: 0,
    longestStreak: 0,
    activeDays: 0,
    avgDailyTokens: 0,
    peakDay: null,
    todayTokens: 0,
  },
  costSummary: null,
  dailyCost: [],
  tools: null,
  costEfficiency: [],
  performance: {
    coverageStartedAt: null,
    coverageEndedAt: null,
    summary: {
      sampleCount: 0,
      firstTokenSampleCount: 0,
      p50FirstTokenMs: null,
      p95FirstTokenMs: null,
      p50TotalDurationMs: null,
      p95TotalDurationMs: null,
    },
    byRuntime: [],
    byProviderTarget: [],
    byModel: [],
    daily: [],
  },
  fleet: null,
  usageReady: true,
  range: '30d',
  onRangeChange: () => {},
  onExport: () => {},
  themeMode: 'light',
}
