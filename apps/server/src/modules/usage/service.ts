import { agents, backendRunSnapshotEvents, backendRunSnapshots, backendSessionBindings, providerTargets, sessions, usageLogs } from '@cradle/db'
import { and, eq, sql } from 'drizzle-orm'

import { db } from '../../infra'
import { reconcileCompletedCradleClaudeUsage } from '../chat-runtime-providers/claude-agent/usage-reconciliation'
import type { CodexThreadUsageDiagnostics } from '../chat-runtime-providers/codex/app-server/account-diagnostics'
import {
  readCodexThreadUsage,
} from '../chat-runtime-providers/codex/app-server/account-diagnostics'
import { estimateCost, estimateCostBreakdown } from './pricing'

const usageTurnKey = sql`COALESCE(${usageLogs.runId}, ${usageLogs.providerTurnId}, ${usageLogs.id})`

export async function reconcileCompletedClaudeUsage(maxBindings?: number): Promise<{
  bindings: number
  transcripts: number
  inserted: number
  duplicates: number
  incidents: number
}> {
  return reconcileCompletedCradleClaudeUsage({ maxBindings })
}

export interface DailyUsage {
  date: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  count: number
}

export interface DailyUsageByModel {
  date: string
  modelId: string
  totalTokens: number
  count: number
}

export interface HourlyUsage {
  hour: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  count: number
}

export interface UsageSummary {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalTurns: number
  byAgent: Array<{ agentId: string, agentName: string, totalTokens: number, count: number }>
  byProviderTarget: Array<{ providerTargetId: string, providerTargetName: string | null, totalTokens: number, count: number }>
  byModel: Array<{ modelId: string, totalTokens: number, count: number }>
}

export function getDailyUsage(days = 365): DailyUsage[] {
  const rows = db().all<{
    date: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= unixepoch('now', 'localtime', '-' || ${days} || ' days')
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime')
    ORDER BY date ASC
  `)

  return rows.map(row => ({
    date: row.date,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    count: row.count,
  }))
}

// Same grain as getDailyUsage, plus a model_id dimension — powers the
// "which model" drill-down in heatmap/pattern tooltips on the usage
// dashboard. Runs are pre-model, so a row's model can be null; those are
// bucketed under 'unknown' rather than dropped, mirroring getDailyCost.
export function getDailyUsageByModel(days = 365): DailyUsageByModel[] {
  const rows = db().all<{
    date: string
    model_id: string
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= unixepoch('now', 'localtime', '-' || ${days} || ' days')
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime'), model_id
    ORDER BY date ASC, total_tokens DESC
  `)

  return rows.map(row => ({
    date: row.date,
    modelId: row.model_id,
    totalTokens: row.total_tokens,
    count: row.count,
  }))
}

export function getHourlyUsagePattern(): HourlyUsage[] {
  const rows = db().all<{
    hour: number
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      CAST(strftime('%H', ${usageLogs.createdAt}, 'unixepoch', 'localtime') AS INTEGER) AS hour,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    GROUP BY hour
    ORDER BY hour ASC
  `)

  const rowsByHour = new Map(rows.map(row => [row.hour, row]))
  return Array.from({ length: 24 }, (_, hour) => {
    const row = rowsByHour.get(hour)
    return {
      hour,
      promptTokens: row?.prompt_tokens ?? 0,
      completionTokens: row?.completion_tokens ?? 0,
      totalTokens: row?.total_tokens ?? 0,
      count: row?.count ?? 0,
    }
  })
}

export function getUsageSummary(from?: string, to?: string): UsageSummary {
  const { fromEpoch, toEpoch } = resolveTimeRange(from, to)
  const totals = db().get<{
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      COALESCE(SUM(${usageLogs.promptTokens}), 0) AS prompt_tokens,
      COALESCE(SUM(${usageLogs.completionTokens}), 0) AS completion_tokens,
      COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= ${fromEpoch}
      AND ${usageLogs.createdAt} < ${toEpoch}
  `)

  // Agent-level aggregation: usage_logs → sessions → agents
  const byAgent = db().all<{
    agent_id: string
    agent_name: string
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      ${agents.id} AS agent_id,
      ${agents.name} AS agent_name,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    INNER JOIN ${sessions} ON ${sessions.id} = ${usageLogs.sessionId}
    INNER JOIN ${agents} ON ${agents.id} = ${sessions.agentId}
    WHERE ${usageLogs.createdAt} >= ${fromEpoch}
      AND ${usageLogs.createdAt} < ${toEpoch}
    GROUP BY ${agents.id}, ${agents.name}
    ORDER BY total_tokens DESC
  `)

  // Provider-level aggregation (which provider endpoint handled the request)
  const byProviderTarget = db().all<{
    provider_target_id: string
    provider_target_name: string | null
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      ${usageLogs.providerTargetId} AS provider_target_id,
      ${providerTargets.displayName} AS provider_target_name,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    LEFT JOIN ${providerTargets} ON ${providerTargets.id} = ${usageLogs.providerTargetId}
    WHERE ${usageLogs.providerTargetId} IS NOT NULL
      AND ${usageLogs.createdAt} >= ${fromEpoch}
      AND ${usageLogs.createdAt} < ${toEpoch}
    GROUP BY ${usageLogs.providerTargetId}, ${providerTargets.displayName}
    ORDER BY total_tokens DESC
  `)

  const byModel = db().all<{
    model_id: string
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      ${usageLogs.modelId} AS model_id,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    WHERE ${usageLogs.modelId} IS NOT NULL
      AND ${usageLogs.createdAt} >= ${fromEpoch}
      AND ${usageLogs.createdAt} < ${toEpoch}
    GROUP BY ${usageLogs.modelId}
    ORDER BY total_tokens DESC
  `)

  return {
    totalPromptTokens: totals?.prompt_tokens ?? 0,
    totalCompletionTokens: totals?.completion_tokens ?? 0,
    totalTokens: totals?.total_tokens ?? 0,
    totalTurns: totals?.count ?? 0,
    byAgent: byAgent.map(row => ({
      agentId: row.agent_id,
      agentName: row.agent_name,
      totalTokens: row.total_tokens,
      count: row.count,
    })),
    byProviderTarget: byProviderTarget.map(row => ({
      providerTargetId: row.provider_target_id,
      providerTargetName: row.provider_target_name,
      totalTokens: row.total_tokens,
      count: row.count,
    })),
    byModel: byModel.map(row => ({
      modelId: row.model_id,
      totalTokens: row.total_tokens,
      count: row.count,
    })),
  }
}

export function getUsageStats(): {
  currentStreak: number
  longestStreak: number
  activeDays: number
  avgDailyTokens: number
  peakDay: { date: string, totalTokens: number } | null
  todayTokens: number
} {
  const activeDateRows = db().all<{ date: string }>(sql`
    SELECT DISTINCT date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date
    FROM ${usageLogs}
    ORDER BY date ASC
  `)

  const dates = activeDateRows.map(row => row.date)
  const activeDays = dates.length
  let currentStreak = 0
  let longestStreak = 0
  let streak = 0
  // Use local date to match the 'localtime' modifier in DB queries
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  if (dates.length > 0) {
    const todayDate = new Date(today)
    const lastActive = new Date(dates.at(-1)!)
    const daysSinceLast = Math.floor((todayDate.getTime() - lastActive.getTime()) / 86400000)

    if (daysSinceLast <= 1) {
      currentStreak = 1
      for (let index = dates.length - 2; index >= 0; index--) {
        const current = new Date(dates[index + 1])
        const previous = new Date(dates[index])
        const gap = Math.floor((current.getTime() - previous.getTime()) / 86400000)
        if (gap === 1) {
          currentStreak++
        }
        else {
          break
        }
      }
    }

    streak = 1
    longestStreak = 1
    for (let index = 1; index < dates.length; index++) {
      const current = new Date(dates[index])
      const previous = new Date(dates[index - 1])
      const gap = Math.floor((current.getTime() - previous.getTime()) / 86400000)
      if (gap === 1) {
        streak++
        if (streak > longestStreak) {
          longestStreak = streak
        }
      }
      else {
        streak = 1
      }
    }
  }

  const totalRow = db().get<{ total: number }>(sql`
    SELECT COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total FROM ${usageLogs}
  `)
  const avgDailyTokens = activeDays > 0 ? Math.round((totalRow?.total ?? 0) / activeDays) : 0

  const peakRow = db().get<{ date: string, total_tokens: number }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      SUM(${usageLogs.totalTokens}) AS total_tokens
    FROM ${usageLogs}
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime')
    ORDER BY total_tokens DESC
    LIMIT 1
  `)
  const peakDay = peakRow ? { date: peakRow.date, totalTokens: peakRow.total_tokens } : null

  const todayRow = db().get<{ total: number }>(sql`
    SELECT COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total
    FROM ${usageLogs}
    WHERE date(${usageLogs.createdAt}, 'unixepoch', 'localtime') = date('now', 'localtime')
  `)

  return {
    currentStreak,
    longestStreak,
    activeDays,
    avgDailyTokens,
    peakDay,
    todayTokens: todayRow?.total ?? 0,
  }
}

export interface SessionProviderBillingCheck {
  source: 'codex.account.usage.thread'
  status: 'available' | 'unavailable' | 'error'
  reason: string | null
  threadId: string
  reconciliationStatus: 'pending' | 'completed' | 'blocked' | 'unavailable'
  estimatedUsageCreditsMicros: string | null
  estimatedUsageUsdMicros: string | null
  providerTotalTokens: string | null
  ledgerTotalTokens: number
  tokenDelta: string | null
  groups: CodexThreadUsageDiagnostics['groups']
}

export interface SessionUsage {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  count: number
  byModel: Array<{
    modelId: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    turnCount: number
  }>
  providerBillingCheck: SessionProviderBillingCheck | null
}

export function getSessionUsage(sessionId: string): SessionUsage {
  const row = db().get<{
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      COALESCE(SUM(${usageLogs.promptTokens}), 0) AS prompt_tokens,
      COALESCE(SUM(${usageLogs.completionTokens}), 0) AS completion_tokens,
      COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    WHERE ${usageLogs.sessionId} = ${sessionId}
  `)

  const byModel = db().all<{
    model_id: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    turn_count: number
  }>(sql`
    SELECT
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      COALESCE(SUM(${usageLogs.promptTokens}), 0) AS prompt_tokens,
      COALESCE(SUM(${usageLogs.completionTokens}), 0) AS completion_tokens,
      COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS turn_count
    FROM ${usageLogs}
    WHERE ${usageLogs.sessionId} = ${sessionId}
    GROUP BY ${usageLogs.modelId}
    ORDER BY total_tokens DESC, model_id ASC
  `)

  return {
    totalTokens: row?.total_tokens ?? 0,
    promptTokens: row?.prompt_tokens ?? 0,
    completionTokens: row?.completion_tokens ?? 0,
    count: row?.count ?? 0,
    byModel: byModel.map(model => ({
      modelId: model.model_id,
      promptTokens: model.prompt_tokens,
      completionTokens: model.completion_tokens,
      totalTokens: model.total_tokens,
      turnCount: model.turn_count,
    })),
    providerBillingCheck: null,
  }
}

export async function getSessionUsageWithProviderBillingCheck(
  sessionId: string,
  readThreadUsage: typeof readCodexThreadUsage = readCodexThreadUsage,
): Promise<SessionUsage> {
  const ledgerUsage = getSessionUsage(sessionId)
  return {
    ...ledgerUsage,
    providerBillingCheck: await readSessionProviderBillingCheck(
      sessionId,
      ledgerUsage.totalTokens,
      readThreadUsage,
    ),
  }
}

async function readSessionProviderBillingCheck(
  sessionId: string,
  ledgerTotalTokens: number,
  readThreadUsage: typeof readCodexThreadUsage,
): Promise<SessionProviderBillingCheck | null> {
  const binding = db().select({
    providerTargetId: backendSessionBindings.providerTargetId,
    threadId: backendSessionBindings.backendSessionId,
    reconciliationStatus: backendSessionBindings.usageReconciliationStatus,
  }).from(backendSessionBindings).where(and(
    eq(backendSessionBindings.chatSessionId, sessionId),
    eq(backendSessionBindings.runtimeKind, 'codex'),
  )).get()

  if (!binding?.threadId) {
    return null
  }

  const base = {
    source: 'codex.account.usage.thread' as const,
    threadId: binding.threadId,
    reconciliationStatus: binding.reconciliationStatus,
    ledgerTotalTokens,
  }

  if (!binding.providerTargetId) {
    return {
      ...base,
      status: 'unavailable',
      reason: 'The Codex session has no provider target for billing diagnostics.',
      estimatedUsageCreditsMicros: null,
      estimatedUsageUsdMicros: null,
      providerTotalTokens: null,
      tokenDelta: null,
      groups: [],
    }
  }

  try {
    const providerUsage = await readThreadUsage({
      providerTargetId: binding.providerTargetId,
      threadId: binding.threadId,
    })
    if (!providerUsage) {
      return {
        ...base,
        status: 'unavailable',
        reason: 'The Codex provider did not return per-thread billing usage.',
        estimatedUsageCreditsMicros: null,
        estimatedUsageUsdMicros: null,
        providerTotalTokens: null,
        tokenDelta: null,
        groups: [],
      }
    }

    const providerTotalTokens = sumProviderTotalTokens(providerUsage.groups)
    return {
      ...base,
      status: 'available',
      reason: null,
      estimatedUsageCreditsMicros: providerUsage.estimatedUsageCreditsMicros,
      estimatedUsageUsdMicros: providerUsage.estimatedUsageUsdMicros,
      providerTotalTokens,
      tokenDelta: providerTotalTokens === null
        ? null
        : String(BigInt(providerTotalTokens) - BigInt(ledgerTotalTokens)),
      groups: providerUsage.groups,
    }
  }
  catch (error) {
    return {
      ...base,
      status: 'error',
      reason: error instanceof Error ? error.message : String(error),
      estimatedUsageCreditsMicros: null,
      estimatedUsageUsdMicros: null,
      providerTotalTokens: null,
      tokenDelta: null,
      groups: [],
    }
  }
}

function sumProviderTotalTokens(groups: CodexThreadUsageDiagnostics['groups']): string | null {
  const totals = groups.flatMap(group => group.totalTokens === null ? [] : [BigInt(group.totalTokens)])
  return totals.length === 0
    ? null
    : String(totals.reduce((total, value) => total + value, 0n))
}

// ── Cost Dashboard queries ──
// Cost is calculated on-the-fly from usage_logs token counts × current model pricing.
// Uses usage_logs (always populated) instead of step_usage (may be empty for some providers).

export interface CostSummary {
  totalCostUsd: number
  totalPromptTokens: number
  totalUncachedInputTokens: number
  totalCachedInputTokens: number
  totalCacheWriteInputTokens: number
  totalCompletionTokens: number
  totalTokens: number
  uncachedInputCostUsd: number
  cacheReadCostUsd: number
  cacheWriteCostUsd: number
  outputCostUsd: number
  byModel: Array<CostBreakdownTotals & { modelId: string }>
  byAgent: Array<CostBreakdownTotals & { agentId: string, agentName: string }>
  byProviderTarget: Array<CostBreakdownTotals & { providerTargetId: string, providerTargetName: string | null }>
}

interface CostBreakdownTotals {
  costUsd: number
  promptTokens: number
  uncachedInputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  completionTokens: number
  totalTokens: number
  uncachedInputCostUsd: number
  cacheReadCostUsd: number
  cacheWriteCostUsd: number
  outputCostUsd: number
  count: number
}

export function resolveTimeRange(from?: string, to?: string): { fromEpoch: number, toEpoch: number } {
  const fromEpoch = from ? Math.floor(new Date(from).getTime() / 1000) : 0
  const toEpoch = to ? Math.floor(new Date(to).getTime() / 1000) + 86400 : Math.floor(Date.now() / 1000) + 86400
  return { fromEpoch, toEpoch }
}

export function getCostSummary(from?: string, to?: string): CostSummary {
  const { fromEpoch, toEpoch } = resolveTimeRange(from, to)

  const rows = db().all<{
    model_id: string
    agent_id: string | null
    agent_name: string | null
    provider_target_id: string | null
    provider_target_name: string | null
    prompt_tokens: number
    cached_input_tokens: number
    cache_write_input_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      ${sessions.agentId} AS agent_id,
      ${agents.name} AS agent_name,
      ${usageLogs.providerTargetId} AS provider_target_id,
      ${providerTargets.displayName} AS provider_target_name,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.cachedInputTokens}) AS cached_input_tokens,
      SUM(${usageLogs.cacheWriteInputTokens}) AS cache_write_input_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS count
    FROM ${usageLogs}
    INNER JOIN ${sessions} ON ${sessions.id} = ${usageLogs.sessionId}
    LEFT JOIN ${agents} ON ${agents.id} = ${sessions.agentId}
    LEFT JOIN ${providerTargets} ON ${providerTargets.id} = ${usageLogs.providerTargetId}
    WHERE ${usageLogs.createdAt} >= ${fromEpoch}
      AND ${usageLogs.createdAt} < ${toEpoch}
    GROUP BY
      ${usageLogs.modelId},
      ${sessions.agentId},
      ${agents.name},
      ${usageLogs.providerTargetId},
      ${providerTargets.displayName}
  `)

  const modelMap = new Map<string, CostBreakdownTotals>()
  const agentMap = new Map<string, CostBreakdownTotals & { agentName: string }>()
  const providerTargetMap = new Map<string, CostBreakdownTotals & { providerTargetName: string | null }>()

  for (const row of rows) {
    const cost = estimateCostBreakdown(row.model_id, {
      promptTokens: row.prompt_tokens,
      cachedInputTokens: row.cached_input_tokens,
      cacheWriteInputTokens: row.cache_write_input_tokens,
      completionTokens: row.completion_tokens,
    })
    addCostBreakdown(modelMap, row.model_id, {
      costUsd: cost.totalCostUsd,
      promptTokens: row.prompt_tokens,
      uncachedInputTokens: cost.uncachedInputTokens,
      cachedInputTokens: row.cached_input_tokens,
      cacheWriteInputTokens: row.cache_write_input_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      uncachedInputCostUsd: cost.uncachedInputCostUsd,
      cacheReadCostUsd: cost.cacheReadCostUsd,
      cacheWriteCostUsd: cost.cacheWriteCostUsd,
      outputCostUsd: cost.outputCostUsd,
      count: row.count,
    })
    if (row.agent_id && row.agent_name) {
      addNamedCostBreakdown(agentMap, row.agent_id, 'agentName', row.agent_name, {
        costUsd: cost.totalCostUsd,
        promptTokens: row.prompt_tokens,
        uncachedInputTokens: cost.uncachedInputTokens,
        cachedInputTokens: row.cached_input_tokens,
        cacheWriteInputTokens: row.cache_write_input_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        uncachedInputCostUsd: cost.uncachedInputCostUsd,
        cacheReadCostUsd: cost.cacheReadCostUsd,
        cacheWriteCostUsd: cost.cacheWriteCostUsd,
        outputCostUsd: cost.outputCostUsd,
        count: row.count,
      })
    }
    if (row.provider_target_id) {
      addNamedCostBreakdown(providerTargetMap, row.provider_target_id, 'providerTargetName', row.provider_target_name, {
        costUsd: cost.totalCostUsd,
        promptTokens: row.prompt_tokens,
        uncachedInputTokens: cost.uncachedInputTokens,
        cachedInputTokens: row.cached_input_tokens,
        cacheWriteInputTokens: row.cache_write_input_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        uncachedInputCostUsd: cost.uncachedInputCostUsd,
        cacheReadCostUsd: cost.cacheReadCostUsd,
        cacheWriteCostUsd: cost.cacheWriteCostUsd,
        outputCostUsd: cost.outputCostUsd,
        count: row.count,
      })
    }
  }

  const byModel = Array.from(modelMap.entries())
    .map(([modelId, data]) => ({ modelId, ...data }))
    .sort((a, b) => b.costUsd - a.costUsd)
  const byAgent = Array.from(agentMap.entries())
    .map(([agentId, data]) => ({ agentId, ...data }))
    .sort((a, b) => b.costUsd - a.costUsd)
  const byProviderTarget = Array.from(providerTargetMap.entries())
    .map(([providerTargetId, data]) => ({ providerTargetId, ...data }))
    .sort((a, b) => b.costUsd - a.costUsd)

  return {
    totalCostUsd: byModel.reduce((sum, row) => sum + row.costUsd, 0),
    totalPromptTokens: byModel.reduce((sum, row) => sum + row.promptTokens, 0),
    totalUncachedInputTokens: byModel.reduce((sum, row) => sum + row.uncachedInputTokens, 0),
    totalCachedInputTokens: byModel.reduce((sum, row) => sum + row.cachedInputTokens, 0),
    totalCacheWriteInputTokens: byModel.reduce((sum, row) => sum + row.cacheWriteInputTokens, 0),
    totalCompletionTokens: byModel.reduce((sum, row) => sum + row.completionTokens, 0),
    totalTokens: byModel.reduce((sum, row) => sum + row.totalTokens, 0),
    uncachedInputCostUsd: byModel.reduce((sum, row) => sum + row.uncachedInputCostUsd, 0),
    cacheReadCostUsd: byModel.reduce((sum, row) => sum + row.cacheReadCostUsd, 0),
    cacheWriteCostUsd: byModel.reduce((sum, row) => sum + row.cacheWriteCostUsd, 0),
    outputCostUsd: byModel.reduce((sum, row) => sum + row.outputCostUsd, 0),
    byModel,
    byAgent,
    byProviderTarget,
  }
}

function addCostBreakdown(map: Map<string, CostBreakdownTotals>, key: string, data: CostBreakdownTotals): void {
  const current = map.get(key)
  if (!current) {
    map.set(key, { ...data })
    return
  }
  current.costUsd += data.costUsd
  current.promptTokens += data.promptTokens
  current.uncachedInputTokens += data.uncachedInputTokens
  current.cachedInputTokens += data.cachedInputTokens
  current.cacheWriteInputTokens += data.cacheWriteInputTokens
  current.completionTokens += data.completionTokens
  current.totalTokens += data.totalTokens
  current.uncachedInputCostUsd += data.uncachedInputCostUsd
  current.cacheReadCostUsd += data.cacheReadCostUsd
  current.cacheWriteCostUsd += data.cacheWriteCostUsd
  current.outputCostUsd += data.outputCostUsd
  current.count += data.count
}

function addNamedCostBreakdown<NameKey extends string>(
  map: Map<string, CostBreakdownTotals & Record<NameKey, string | null>>,
  key: string,
  nameKey: NameKey,
  name: string | null,
  data: CostBreakdownTotals,
): void {
  const current = map.get(key)
  if (!current) {
    map.set(key, { ...data, [nameKey]: name } as CostBreakdownTotals & Record<NameKey, string | null>)
    return
  }
  current.costUsd += data.costUsd
  current.promptTokens += data.promptTokens
  current.uncachedInputTokens += data.uncachedInputTokens
  current.cachedInputTokens += data.cachedInputTokens
  current.cacheWriteInputTokens += data.cacheWriteInputTokens
  current.completionTokens += data.completionTokens
  current.totalTokens += data.totalTokens
  current.uncachedInputCostUsd += data.uncachedInputCostUsd
  current.cacheReadCostUsd += data.cacheReadCostUsd
  current.cacheWriteCostUsd += data.cacheWriteCostUsd
  current.outputCostUsd += data.outputCostUsd
  current.count += data.count
}

export interface SessionCostEntry {
  sessionId: string
  costUsd: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  stepCount: number
}

export interface RecentUsageSession {
  sessionId: string
  title: string
  agentId: string | null
  agentName: string | null
  modelId: string
  costUsd: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  turnCount: number
  createdAt: number
  updatedAt: number
  lastUsageAt: number
}

export function getSessionsCost(from?: string, to?: string): SessionCostEntry[] {
  const { fromEpoch, toEpoch } = resolveTimeRange(from, to)

  const rows = db().all<{
    session_id: string
    model_id: string
    prompt_tokens: number
    cached_input_tokens: number
    cache_write_input_tokens: number
    completion_tokens: number
    total_tokens: number
    step_count: number
  }>(sql`
    SELECT
      ${usageLogs.sessionId} AS session_id,
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.cachedInputTokens}) AS cached_input_tokens,
      SUM(${usageLogs.cacheWriteInputTokens}) AS cache_write_input_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS step_count
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= ${fromEpoch}
      AND ${usageLogs.createdAt} < ${toEpoch}
    GROUP BY ${usageLogs.sessionId}, ${usageLogs.modelId}
  `)

  const sessionMap = new Map<string, { costUsd: number, promptTokens: number, completionTokens: number, totalTokens: number, stepCount: number }>()
  for (const row of rows) {
    const cost = estimateCost(row.model_id, {
      promptTokens: row.prompt_tokens,
      cachedInputTokens: row.cached_input_tokens,
      cacheWriteInputTokens: row.cache_write_input_tokens,
      completionTokens: row.completion_tokens,
    })
    const entry = sessionMap.get(row.session_id)
    if (entry) {
      entry.costUsd += cost
      entry.promptTokens += row.prompt_tokens
      entry.completionTokens += row.completion_tokens
      entry.totalTokens += row.total_tokens
      entry.stepCount += row.step_count
    }
    else {
      sessionMap.set(row.session_id, {
        costUsd: cost,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        stepCount: row.step_count,
      })
    }
  }

  return Array.from(sessionMap.entries())
    .map(([sessionId, data]) => ({ sessionId, ...data }))
    .sort((a, b) => b.costUsd - a.costUsd)
}

export function getRecentUsageSessions(limit = 6): RecentUsageSession[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20)

  const rows = db().all<{
    session_id: string
    title: string
    agent_id: string | null
    agent_name: string | null
    model_id: string
    cost_model_id: string
    prompt_tokens: number
    cached_input_tokens: number
    cache_write_input_tokens: number
    completion_tokens: number
    total_tokens: number
    turn_count: number
    created_at: number
    updated_at: number
    last_usage_at: number
  }>(sql`
    WITH recent_sessions AS (
      SELECT
        usage_session_logs.session_id AS session_id,
        MAX(usage_session_logs.created_at) AS last_usage_at,
        (
          SELECT COALESCE(latest_usage_logs.model_id, 'unknown')
          FROM usage_logs latest_usage_logs
          WHERE latest_usage_logs.session_id = usage_session_logs.session_id
          ORDER BY latest_usage_logs.created_at DESC, latest_usage_logs.id DESC
          LIMIT 1
        ) AS model_id
      FROM usage_logs usage_session_logs
      GROUP BY usage_session_logs.session_id
      ORDER BY last_usage_at DESC
      LIMIT ${safeLimit}
    )
    SELECT
      recent_sessions.session_id AS session_id,
      ${sessions.title} AS title,
      ${sessions.agentId} AS agent_id,
      ${agents.name} AS agent_name,
      recent_sessions.model_id AS model_id,
      COALESCE(${usageLogs.modelId}, 'unknown') AS cost_model_id,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.cachedInputTokens}) AS cached_input_tokens,
      SUM(${usageLogs.cacheWriteInputTokens}) AS cache_write_input_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS turn_count,
      ${sessions.createdAt} AS created_at,
      ${sessions.updatedAt} AS updated_at,
      recent_sessions.last_usage_at AS last_usage_at
    FROM recent_sessions
    INNER JOIN ${usageLogs} ON ${usageLogs.sessionId} = recent_sessions.session_id
    INNER JOIN ${sessions} ON ${sessions.id} = recent_sessions.session_id
    LEFT JOIN ${agents} ON ${agents.id} = ${sessions.agentId}
    GROUP BY
      recent_sessions.session_id,
      ${sessions.title},
      ${sessions.agentId},
      ${agents.name},
      recent_sessions.model_id,
      cost_model_id,
      ${sessions.createdAt},
      ${sessions.updatedAt},
      recent_sessions.last_usage_at
    ORDER BY recent_sessions.last_usage_at DESC, recent_sessions.session_id ASC
  `)

  const sessionMap = new Map<string, RecentUsageSession>()
  for (const row of rows) {
    const costUsd = estimateCost(row.cost_model_id, {
      promptTokens: row.prompt_tokens,
      cachedInputTokens: row.cached_input_tokens,
      cacheWriteInputTokens: row.cache_write_input_tokens,
      completionTokens: row.completion_tokens,
    })
    const current = sessionMap.get(row.session_id)
    if (current) {
      current.costUsd += costUsd
      current.promptTokens += row.prompt_tokens
      current.completionTokens += row.completion_tokens
      current.totalTokens += row.total_tokens
      current.turnCount += row.turn_count
      continue
    }
    sessionMap.set(row.session_id, {
      sessionId: row.session_id,
      title: row.title,
      agentId: row.agent_id,
      agentName: row.agent_name,
      modelId: row.model_id,
      costUsd,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      turnCount: row.turn_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastUsageAt: row.last_usage_at,
    })
  }

  return Array.from(sessionMap.values())
}

export interface DailyCostEntry {
  date: string
  modelId: string
  costUsd: number
  promptTokens: number
  uncachedInputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  completionTokens: number
  totalTokens: number
  uncachedInputCostUsd: number
  cacheReadCostUsd: number
  cacheWriteCostUsd: number
  outputCostUsd: number
  stepCount: number
}

// One row per calendar day × model so the trend chart can stack cost by model
// the same way `/daily-by-model` stacks tokens. Callers that only need a daily
// total (hero KPIs) should sum costUsd across model rows for each date.
export function getDailyCost(from?: string, to?: string): DailyCostEntry[] {
  const { fromEpoch, toEpoch } = resolveTimeRange(from, to)

  const rows = db().all<{
    date: string
    model_id: string
    prompt_tokens: number
    cached_input_tokens: number
    cache_write_input_tokens: number
    completion_tokens: number
    total_tokens: number
    step_count: number
  }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.cachedInputTokens}) AS cached_input_tokens,
      SUM(${usageLogs.cacheWriteInputTokens}) AS cache_write_input_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT ${usageTurnKey}) AS step_count
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= ${fromEpoch}
      AND ${usageLogs.createdAt} < ${toEpoch}
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime'), ${usageLogs.modelId}
    ORDER BY date ASC, model_id ASC
  `)

  return rows.map((row) => {
    const cost = estimateCostBreakdown(row.model_id, {
      promptTokens: row.prompt_tokens,
      cachedInputTokens: row.cached_input_tokens,
      cacheWriteInputTokens: row.cache_write_input_tokens,
      completionTokens: row.completion_tokens,
    })
    return {
      date: row.date,
      modelId: row.model_id,
      costUsd: cost.totalCostUsd,
      promptTokens: row.prompt_tokens,
      uncachedInputTokens: cost.uncachedInputTokens,
      cachedInputTokens: row.cached_input_tokens,
      cacheWriteInputTokens: row.cache_write_input_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      uncachedInputCostUsd: cost.uncachedInputCostUsd,
      cacheReadCostUsd: cost.cacheReadCostUsd,
      cacheWriteCostUsd: cost.cacheWriteCostUsd,
      outputCostUsd: cost.outputCostUsd,
      stepCount: row.step_count,
    }
  })
}

export function getTodayCostUsd(): number {
  const rows = db().all<{
    model_id: string
    prompt_tokens: number
    cached_input_tokens: number
    cache_write_input_tokens: number
    completion_tokens: number
  }>(sql`
    SELECT
      COALESCE(${usageLogs.modelId}, 'unknown') AS model_id,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.cachedInputTokens}) AS cached_input_tokens,
      SUM(${usageLogs.cacheWriteInputTokens}) AS cache_write_input_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens
    FROM ${usageLogs}
    WHERE date(${usageLogs.createdAt}, 'unixepoch', 'localtime') = date('now', 'localtime')
    GROUP BY ${usageLogs.modelId}
  `)

  return rows.reduce(
    (sum, row) => sum + estimateCost(row.model_id, {
      promptTokens: row.prompt_tokens,
      cachedInputTokens: row.cached_input_tokens,
      cacheWriteInputTokens: row.cache_write_input_tokens,
      completionTokens: row.completion_tokens,
    }),
    0,
  )
}

// ── Tool Usage Breakdown ──

export interface ToolUsageEntry {
  toolName: string
  count: number
  successCount: number
  failureCount: number
  deniedCount: number
  interruptedCount: number
  medianDurationMs: number | null
}

export interface ToolUsageByRuntime {
  runtimeKind: string
  tools: ToolUsageEntry[]
}

export interface ToolUsageByModel {
  modelId: string
  tools: ToolUsageEntry[]
}

export interface ToolUsageSummary {
  totalCalls: number
  successCount: number
  failureCount: number
  deniedCount: number
  interruptedCount: number
  successRatePct: number
  uniqueToolCount: number
  medianDurationMs: number | null
}

export interface DailyToolUsage {
  date: string
  toolName: string
  count: number
}

export interface DailyToolUsageByRuntime extends DailyToolUsage {
  runtimeKind: string
}

export interface DailyToolUsageByModel extends DailyToolUsage {
  modelId: string
}

export interface ToolUsageBreakdown {
  overall: ToolUsageEntry[]
  byRuntime: ToolUsageByRuntime[]
  byModel: ToolUsageByModel[]
  summary: ToolUsageSummary
  daily: DailyToolUsage[]
  dailyByRuntime: DailyToolUsageByRuntime[]
  dailyByModel: DailyToolUsageByModel[]
}

type ToolCallOutcome = 'success' | 'failure' | 'denied' | 'interrupted'

interface ToolCallRecord {
  toolName: string
  runtimeKind: string
  modelId: string
  outcome: ToolCallOutcome
  durationMs: number | null
  startMs: number
}

// Aggregates per tool CALL (grouped by tool_call_id), not per event row: only
// the started/input_available phases carry a tool_name, while terminal phases
// only carry the tool_call_id, so row-counting double-counts calls and never
// sees outcomes.
export function getToolUsageBreakdown(from?: number): ToolUsageBreakdown {
  const rows = db().all<{
    tool_call_id: string
    tool_name: string | null
    phase: string
    occurred_at: number
    runtime_kind: string
    model_id: string | null
  }>(sql`
    SELECT
      ${backendRunSnapshotEvents.toolCallId} AS tool_call_id,
      ${backendRunSnapshotEvents.toolName} AS tool_name,
      ${backendRunSnapshotEvents.phase} AS phase,
      ${backendRunSnapshotEvents.occurredAt} AS occurred_at,
      ${backendRunSnapshots.runtimeKind} AS runtime_kind,
      ${backendRunSnapshots.modelId} AS model_id
    FROM ${backendRunSnapshotEvents}
    INNER JOIN ${backendRunSnapshots} ON ${backendRunSnapshots.id} = ${backendRunSnapshotEvents.snapshotId}
    WHERE ${backendRunSnapshotEvents.toolCallId} IS NOT NULL
      ${from !== undefined ? sql`AND ${backendRunSnapshotEvents.occurredAt} >= ${from}` : sql``}
  `)

  const calls = collectToolCalls(rows)

  const overallMap = new Map<string, ToolAccumulator>()
  const runtimeMap = new Map<string, Map<string, ToolAccumulator>>()
  const modelMap = new Map<string, Map<string, ToolAccumulator>>()
  const dailyMap = new Map<string, number>()
  const dailyRuntimeMap = new Map<string, number>()
  const dailyModelMap = new Map<string, number>()
  const summaryAcc = createToolAccumulator()

  for (const call of calls) {
    recordCall(ensureToolEntry(overallMap, call.toolName), call)
    recordCall(ensureNestedMap(runtimeMap, call.runtimeKind, call.toolName), call)
    recordCall(ensureNestedMap(modelMap, call.modelId, call.toolName), call)
    recordCall(summaryAcc, call)

    // Local-time date key, matching the other daily series (SQL 'localtime')
    // and the client's day-window bucketing. startMs is millisecond epoch.
    const startDate = new Date(call.startMs)
    const date = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`
    const dailyKey = `${date}|${call.toolName}`
    dailyMap.set(dailyKey, (dailyMap.get(dailyKey) ?? 0) + 1)
    const dailyRuntimeKey = `${date}|${call.runtimeKind}|${call.toolName}`
    dailyRuntimeMap.set(dailyRuntimeKey, (dailyRuntimeMap.get(dailyRuntimeKey) ?? 0) + 1)
    const dailyModelKey = `${date}|${call.modelId}|${call.toolName}`
    dailyModelMap.set(dailyModelKey, (dailyModelMap.get(dailyModelKey) ?? 0) + 1)
  }

  const daily = Array.from(dailyMap.entries())
    .map(([key, count]) => {
      const [date, toolName] = key.split('|')
      return { date, toolName, count }
    })
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

  const dailyByRuntime = Array.from(dailyRuntimeMap.entries())
    .map(([key, count]) => {
      const [date, runtimeKind, toolName] = key.split('|')
      return { date, runtimeKind, toolName, count }
    })
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

  const dailyByModel = Array.from(dailyModelMap.entries())
    .map(([key, count]) => {
      const [date, modelId, toolName] = key.split('|')
      return { date, modelId, toolName, count }
    })
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

  const successDenominator = summaryAcc.successCount + summaryAcc.failureCount

  return {
    overall: mapToToolEntries(overallMap),
    byRuntime: Array.from(runtimeMap.entries())
      .map(([runtimeKind, tools]) => ({ runtimeKind, tools: mapToToolEntries(tools) }))
      .sort((a, b) => b.tools.reduce((s, t) => s + t.count, 0) - a.tools.reduce((s, t) => s + t.count, 0)),
    byModel: Array.from(modelMap.entries())
      .map(([modelId, tools]) => ({ modelId, tools: mapToToolEntries(tools) }))
      .sort((a, b) => b.tools.reduce((s, t) => s + t.count, 0) - a.tools.reduce((s, t) => s + t.count, 0)),
    summary: {
      totalCalls: summaryAcc.count,
      successCount: summaryAcc.successCount,
      failureCount: summaryAcc.failureCount,
      deniedCount: summaryAcc.deniedCount,
      interruptedCount: summaryAcc.interruptedCount,
      // Denied and interrupted calls never resolved, so they are excluded
      // from the rate denominator.
      successRatePct: successDenominator > 0 ? Math.round((summaryAcc.successCount / successDenominator) * 100) : 0,
      uniqueToolCount: overallMap.size,
      medianDurationMs: medianDurationMs(summaryAcc.durationsMs),
    },
    daily,
    dailyByRuntime,
    dailyByModel,
  }
}

const START_PHASES = new Set(['tool_call_started', 'tool_call_input_available'])
const TERMINAL_PHASES = new Set(['tool_call_output_available', 'tool_call_output_failed', 'tool_call_input_failed', 'tool_call_denied'])

interface ToolEventRow {
  tool_call_id: string
  tool_name: string | null
  phase: string
  occurred_at: number
  runtime_kind: string
  model_id: string | null
}

function collectToolCalls(rows: ToolEventRow[]): ToolCallRecord[] {
  const byCallId = new Map<string, ToolEventRow[]>()
  for (const row of rows) {
    const group = byCallId.get(row.tool_call_id)
    if (group) {
      group.push(row)
    }
    else {
      byCallId.set(row.tool_call_id, [row])
    }
  }

  const calls: ToolCallRecord[] = []
  for (const group of byCallId.values()) {
    const toolName = group.find(row => row.tool_name && row.tool_name !== '')?.tool_name
    if (!toolName) {
      continue
    }

    let outcome: ToolCallOutcome = 'interrupted'
    if (group.some(row => row.phase === 'tool_call_output_available')) {
      outcome = 'success'
    }
    else if (group.some(row => row.phase === 'tool_call_output_failed' || row.phase === 'tool_call_input_failed')) {
      outcome = 'failure'
    }
    else if (group.some(row => row.phase === 'tool_call_denied')) {
      outcome = 'denied'
    }

    const occurredAts = group.map(row => row.occurred_at)
    const startTimes = group.filter(row => START_PHASES.has(row.phase)).map(row => row.occurred_at)
    const endTimes = group.filter(row => TERMINAL_PHASES.has(row.phase)).map(row => row.occurred_at)
    const startMs = startTimes.length > 0 ? Math.min(...startTimes) : Math.min(...occurredAts)

    // occurred_at is millisecond epoch (backend_run_snapshot_events), so the
    // delta is already in ms.
    let durationMs: number | null = null
    if (startTimes.length > 0 && endTimes.length > 0) {
      const deltaMs = Math.max(...endTimes) - Math.min(...startTimes)
      durationMs = deltaMs >= 0 ? deltaMs : null
    }

    calls.push({
      toolName,
      runtimeKind: group[0].runtime_kind,
      modelId: group[0].model_id ?? 'unknown',
      outcome,
      durationMs,
      startMs,
    })
  }
  return calls
}

type ToolAccumulator = { count: number, successCount: number, failureCount: number, deniedCount: number, interruptedCount: number, durationsMs: number[] }

function createToolAccumulator(): ToolAccumulator {
  return { count: 0, successCount: 0, failureCount: 0, deniedCount: 0, interruptedCount: 0, durationsMs: [] }
}

function recordCall(acc: ToolAccumulator, call: ToolCallRecord): void {
  acc.count++
  if (call.outcome === 'success') { acc.successCount++ }
  if (call.outcome === 'failure') { acc.failureCount++ }
  if (call.outcome === 'denied') { acc.deniedCount++ }
  if (call.outcome === 'interrupted') { acc.interruptedCount++ }
  if (call.durationMs !== null) {
    acc.durationsMs.push(call.durationMs)
  }
}

// Median, not mean: a handful of hour-long background/sleep calls drag the
// mean into days (observed: 28h "average" for Bash) while the typical call
// finishes in seconds.
function medianDurationMs(durationsMs: number[]): number | null {
  if (durationsMs.length === 0) {
    return null
  }
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(median)
}

function ensureToolEntry(map: Map<string, ToolAccumulator>, toolName: string): ToolAccumulator {
  let entry = map.get(toolName)
  if (!entry) {
    entry = createToolAccumulator()
    map.set(toolName, entry)
  }
  return entry
}

function ensureNestedMap(
  outer: Map<string, Map<string, ToolAccumulator>>,
  outerKey: string,
  toolName: string,
): ToolAccumulator {
  let inner = outer.get(outerKey)
  if (!inner) {
    inner = new Map()
    outer.set(outerKey, inner)
  }
  return ensureToolEntry(inner, toolName)
}

function mapToToolEntries(map: Map<string, ToolAccumulator>): ToolUsageEntry[] {
  return Array.from(map.entries())
    .map(([toolName, data]) => ({
      toolName,
      count: data.count,
      successCount: data.successCount,
      failureCount: data.failureCount,
      deniedCount: data.deniedCount,
      interruptedCount: data.interruptedCount,
      medianDurationMs: medianDurationMs(data.durationsMs),
    }))
    .sort((a, b) => b.count - a.count)
}

// ── Cost Efficiency Trend ──

export interface DailyCostEfficiency {
  date: string
  totalTokens: number
  runCount: number
  avgTokensPerRun: number
  totalCostUsd: number
  avgCostPerRun: number
}

export function getCostEfficiencyTrend(days = 90): DailyCostEfficiency[] {
  const rows = db().all<{
    date: string
    total_tokens: number
    run_count: number
    model_ids: string
    prompt_tokens: number
    cached_input_tokens: number
    cache_write_input_tokens: number
    completion_tokens: number
  }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(DISTINCT COALESCE(${usageLogs.runId}, ${usageLogs.providerTurnId}, ${usageLogs.id})) AS run_count,
      GROUP_CONCAT(DISTINCT COALESCE(${usageLogs.modelId}, 'unknown')) AS model_ids,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.cachedInputTokens}) AS cached_input_tokens,
      SUM(${usageLogs.cacheWriteInputTokens}) AS cache_write_input_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= unixepoch('now', 'localtime', '-' || ${days} || ' days')
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime')
    ORDER BY date ASC
  `)

  return rows.map((row) => {
    // Estimate cost from the model mix
    const modelIds = row.model_ids ? row.model_ids.split(',') : ['unknown']
    const promptPerModel = Math.round(row.prompt_tokens / Math.max(modelIds.length, 1))
    const cachedInputPerModel = Math.round(row.cached_input_tokens / Math.max(modelIds.length, 1))
    const cacheWriteInputPerModel = Math.round(row.cache_write_input_tokens / Math.max(modelIds.length, 1))
    const completionPerModel = Math.round(row.completion_tokens / Math.max(modelIds.length, 1))
    const totalCostUsd = modelIds.reduce(
      (sum, modelId) => sum + estimateCost(modelId, {
        promptTokens: promptPerModel,
        cachedInputTokens: cachedInputPerModel,
        cacheWriteInputTokens: cacheWriteInputPerModel,
        completionTokens: completionPerModel,
      }),
      0,
    )
    const avgTokensPerRun = row.run_count > 0 ? Math.round(row.total_tokens / row.run_count) : 0
    const avgCostPerRun = row.run_count > 0 ? totalCostUsd / row.run_count : 0

    return {
      date: row.date,
      totalTokens: row.total_tokens,
      runCount: row.run_count,
      avgTokensPerRun,
      totalCostUsd,
      avgCostPerRun,
    }
  })
}
