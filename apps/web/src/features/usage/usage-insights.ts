// Pure calculations that turn the raw daily series into the comparisons and
// call-outs the dashboard surfaces ("+23% vs last week", "busiest on
// Tuesdays"). Everything here is derived from real API data — no mocking.
import type { TFunction } from 'i18next'

import { buildDenseDailySeries, lastDateKeys, weekdayIndexFromDateKey } from './usage-date'
import { categoryColor } from './usage-palette'
import type { DailyCost, DailyToolUsage, DailyUsage, DailyUsageByModel } from './use-usage-overview'

export { weekdayLabel } from './usage-date'

export interface PeriodComparison {
  currentTotal: number
  previousTotal: number
  /** null when the previous period has no data to compare against */
  changePct: number | null
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/**
 * Compares the trailing `days` window against the window immediately before
 * it (e.g. last 7 days vs the 7 days before that). `values` must be a dense,
 * chronologically-ordered series with no date gaps.
 */
export function comparePeriods(values: number[], days: number): PeriodComparison {
  const current = values.slice(-days)
  const previous = values.slice(-days * 2, -days)
  const currentTotal = sum(current)
  const previousTotal = sum(previous)
  const changePct = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : null
  return { currentTotal, previousTotal, changePct }
}

export function denseTokenSeries(daily: DailyUsage[], days: number): DailyUsage[] {
  return buildDenseDailySeries(daily, days, date => ({
    date,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    count: 0,
  }))
}

/**
 * Dense per-day cost totals. `/usage/cost/daily` returns one row per day × model,
 *  so we sum cost (and tokens) per calendar day before densifying gaps.
 */
export function denseCostSeries(dailyCost: DailyCost[], days: number): Array<{
  date: string
  costUsd: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  stepCount: number
}> {
  const byDate = new Map<string, {
    date: string
    costUsd: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    stepCount: number
  }>()
  for (const row of dailyCost) {
    const existing = byDate.get(row.date)
    if (existing) {
      existing.costUsd += row.costUsd
      existing.promptTokens += row.promptTokens
      existing.completionTokens += row.completionTokens
      existing.totalTokens += row.totalTokens
      existing.stepCount += row.stepCount
    }
    else {
      byDate.set(row.date, {
        date: row.date,
        costUsd: row.costUsd,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        totalTokens: row.totalTokens,
        stepCount: row.stepCount,
      })
    }
  }

  return buildDenseDailySeries(Array.from(byDate.values()), days, date => ({
    date,
    costUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    stepCount: 0,
  }))
}

export interface DailyCostComposition {
  date: string
  uncachedInputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  completionTokens: number
  uncachedInputCostUsd: number
  cacheReadCostUsd: number
  cacheWriteCostUsd: number
  outputCostUsd: number
}

export function denseCostCompositionSeries(
  dailyCost: DailyCost[],
  days: number,
): DailyCostComposition[] {
  const byDate = new Map<string, DailyCostComposition>()
  for (const row of dailyCost) {
    const existing = byDate.get(row.date)
    if (existing) {
      existing.uncachedInputTokens += row.uncachedInputTokens
      existing.cachedInputTokens += row.cachedInputTokens
      existing.cacheWriteInputTokens += row.cacheWriteInputTokens
      existing.completionTokens += row.completionTokens
      existing.uncachedInputCostUsd += row.uncachedInputCostUsd
      existing.cacheReadCostUsd += row.cacheReadCostUsd
      existing.cacheWriteCostUsd += row.cacheWriteCostUsd
      existing.outputCostUsd += row.outputCostUsd
    }
    else {
      byDate.set(row.date, {
        date: row.date,
        uncachedInputTokens: row.uncachedInputTokens,
        cachedInputTokens: row.cachedInputTokens,
        cacheWriteInputTokens: row.cacheWriteInputTokens,
        completionTokens: row.completionTokens,
        uncachedInputCostUsd: row.uncachedInputCostUsd,
        cacheReadCostUsd: row.cacheReadCostUsd,
        cacheWriteCostUsd: row.cacheWriteCostUsd,
        outputCostUsd: row.outputCostUsd,
      })
    }
  }
  return buildDenseDailySeries(Array.from(byDate.values()), days, date => ({
    date,
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    completionTokens: 0,
    uncachedInputCostUsd: 0,
    cacheReadCostUsd: 0,
    cacheWriteCostUsd: 0,
    outputCostUsd: 0,
  }))
}

export interface WeekdayInsight {
  weekdayIndex: number
  totalTokens: number
  share: number
}

/** Which day of the week this user is most active on, across up to a year of history. */
export function mostActiveWeekday(daily: DailyUsage[]): WeekdayInsight | null {
  const breakdown = weekdayBreakdown(daily)
  const top = breakdown.reduce((best, entry) => (entry.totalTokens > best.totalTokens ? entry : best), breakdown[0])
  return top && top.totalTokens > 0 ? top : null
}

/** Real per-weekday totals across the full history, oldest data included. */
export function weekdayBreakdown(daily: DailyUsage[]): WeekdayInsight[] {
  const totalsByWeekday: number[] = Array.from<number>({ length: 7 }).fill(0)
  let grandTotal = 0
  for (const day of daily) {
    const weekdayIndex = weekdayIndexFromDateKey(day.date)
    totalsByWeekday[weekdayIndex] += day.totalTokens
    grandTotal += day.totalTokens
  }
  return totalsByWeekday.map((totalTokens, weekdayIndex) => ({
    weekdayIndex,
    totalTokens,
    share: grandTotal > 0 ? totalTokens / grandTotal : 0,
  }))
}

export interface ModelTokenShare {
  modelId: string
  totalTokens: number
}

/** Synthetic key for the collapsed "everything past the top N" bucket — never a real model id. */
export const OTHER_MODEL_KEY = '__other__'

// Stable categorical color + localized label for a model id, shared by the
// trend chart legend/stacks and the per-model tooltip rows. The collapsed
// "other"/"unknown" buckets fall back to a muted tone instead of a palette
// slot so they read as "leftover" rather than another named model.
export function modelCategoryColor(modelId: string, index: number): string {
  if (modelId === OTHER_MODEL_KEY || modelId === 'unknown') {
    return 'var(--color-muted-foreground)'
  }
  return categoryColor(index)
}

export function modelDisplayLabel(modelId: string, t: TFunction<'usage'>): string {
  if (modelId === OTHER_MODEL_KEY) { return t('tooltip.otherModels') }
  if (modelId === 'unknown') { return t('tooltip.unknownModel') }
  return modelId
}

/** Collapses per-model totals to the top `limit` entries plus one "other" bucket for the remainder, so a workspace that has cycled through a dozen models still renders a readable tooltip. */
function topModelShares(entries: ModelTokenShare[], limit: number): ModelTokenShare[] {
  const sorted = [...entries].sort((a, b) => b.totalTokens - a.totalTokens)
  if (sorted.length <= limit) {
    return sorted
  }
  const top = sorted.slice(0, limit)
  const otherTokens = sum(sorted.slice(limit).map(entry => entry.totalTokens))
  return otherTokens > 0 ? [...top, { modelId: OTHER_MODEL_KEY, totalTokens: otherTokens }] : top
}

/** Groups the daily-by-model series by date, for the "which model" line in heatmap day tooltips. */
export function modelBreakdownByDate(dailyByModel: DailyUsageByModel[], limit = 4): Map<string, ModelTokenShare[]> {
  const grouped = new Map<string, ModelTokenShare[]>()
  for (const row of dailyByModel) {
    const entries = grouped.get(row.date) ?? []
    entries.push({ modelId: row.modelId, totalTokens: row.totalTokens })
    grouped.set(row.date, entries)
  }
  for (const [date, entries] of grouped) {
    grouped.set(date, topModelShares(entries, limit))
  }
  return grouped
}

export type ModelStackDatum = Record<string, number | string>

export interface ModelStackSeries {
  /** One datum per calendar day in the window. Carries `date` plus a token count keyed by model id (top-N) or OTHER_MODEL_KEY. */
  series: ModelStackDatum[]
  /** Model ids in stack order (bottom -> top), top-N by total volume then OTHER_MODEL_KEY when there is a remainder. */
  models: string[]
}

/**
 * Pivots the daily-by-model series into one stacked-bar datum per calendar day,
 * for the trend chart's multi-colored "tokens by model" view. Models are ranked
 * by total volume across ALL history (not just the window) so a given model
 * keeps a stable stack position/color as the range slider moves; everything past
 * the top `limit` collapses into the OTHER_MODEL_KEY bucket.
 */
export function denseModelStackSeries(
  dailyByModel: DailyUsageByModel[],
  days: number,
  limit = 6,
): ModelStackSeries {
  const totalsByModel = new Map<string, number>()
  for (const row of dailyByModel) {
    totalsByModel.set(row.modelId, (totalsByModel.get(row.modelId) ?? 0) + row.totalTokens)
  }
  const ranked = [...totalsByModel.entries()].sort((a, b) => b[1] - a[1]).map(([modelId]) => modelId)
  const top = ranked.slice(0, limit)
  const topSet = new Set(top)
  const models = ranked.length > limit ? [...top, OTHER_MODEL_KEY] : [...top]

  const byDate = new Map<string, Map<string, number>>()
  for (const row of dailyByModel) {
    const key = topSet.has(row.modelId) ? row.modelId : OTHER_MODEL_KEY
    const bucket = byDate.get(row.date) ?? new Map<string, number>()
    bucket.set(key, (bucket.get(key) ?? 0) + row.totalTokens)
    byDate.set(row.date, bucket)
  }

  const series: ModelStackDatum[] = lastDateKeys(days).map((date) => {
    const bucket = byDate.get(date)
    const datum: ModelStackDatum = { date }
    for (const modelId of models) {
      datum[modelId] = bucket?.get(modelId) ?? 0
    }
    return datum
  })

  return { series, models }
}

/**
 * Pivots daily cost rows into one stacked-bar datum per calendar day for the
 * cost metric on the trend chart — same shape as denseModelStackSeries but
 * stacking costUsd instead of totalTokens.
 */
export function denseCostModelStackSeries(
  dailyCost: DailyCost[],
  days: number,
  limit = 6,
): ModelStackSeries {
  const totalsByModel = new Map<string, number>()
  for (const row of dailyCost) {
    totalsByModel.set(row.modelId, (totalsByModel.get(row.modelId) ?? 0) + row.costUsd)
  }
  const ranked = [...totalsByModel.entries()].sort((a, b) => b[1] - a[1]).map(([modelId]) => modelId)
  const top = ranked.slice(0, limit)
  const topSet = new Set(top)
  const models = ranked.length > limit ? [...top, OTHER_MODEL_KEY] : [...top]

  const byDate = new Map<string, Map<string, number>>()
  for (const row of dailyCost) {
    const key = topSet.has(row.modelId) ? row.modelId : OTHER_MODEL_KEY
    const bucket = byDate.get(row.date) ?? new Map<string, number>()
    bucket.set(key, (bucket.get(key) ?? 0) + row.costUsd)
    byDate.set(row.date, bucket)
  }

  const series: ModelStackDatum[] = lastDateKeys(days).map((date) => {
    const bucket = byDate.get(date)
    const datum: ModelStackDatum = { date }
    for (const modelId of models) {
      datum[modelId] = bucket?.get(modelId) ?? 0
    }
    return datum
  })

  return { series, models }
}

/**
 * Pivots the daily tool-call series into one stacked-bar datum per calendar
 * day, for the tool usage trend chart. Same shape as denseModelStackSeries
 * but stacking call counts by tool name; everything past the top `limit`
 * collapses into the OTHER_MODEL_KEY bucket (labeled "Other tools" by the caller).
 */
export function denseToolStackSeries(
  daily: DailyToolUsage[],
  days: number,
  limit = 6,
): ModelStackSeries {
  const totalsByTool = new Map<string, number>()
  for (const row of daily) {
    totalsByTool.set(row.toolName, (totalsByTool.get(row.toolName) ?? 0) + row.count)
  }
  const ranked = [...totalsByTool.entries()].sort((a, b) => b[1] - a[1]).map(([toolName]) => toolName)
  const top = ranked.slice(0, limit)
  const topSet = new Set(top)
  const tools = ranked.length > limit ? [...top, OTHER_MODEL_KEY] : [...top]

  const byDate = new Map<string, Map<string, number>>()
  for (const row of daily) {
    const key = topSet.has(row.toolName) ? row.toolName : OTHER_MODEL_KEY
    const bucket = byDate.get(row.date) ?? new Map<string, number>()
    bucket.set(key, (bucket.get(key) ?? 0) + row.count)
    byDate.set(row.date, bucket)
  }

  const series: ModelStackDatum[] = lastDateKeys(days).map((date) => {
    const bucket = byDate.get(date)
    const datum: ModelStackDatum = { date }
    for (const toolName of tools) {
      datum[toolName] = bucket?.get(toolName) ?? 0
    }
    return datum
  })

  return { series, models: tools }
}

/**
 * Generic dense-stack pivot shared by the fleet (per-device) stack helpers:
 * ranks buckets by total volume across ALL history for stable stack position,
 * collapses everything past `limit` into OTHER_MODEL_KEY.
 */
function pivotDenseStack(
  rows: Array<{ date: string, key: string, value: number }>,
  days: number,
  limit: number,
): ModelStackSeries {
  const totalsByKey = new Map<string, number>()
  for (const row of rows) {
    totalsByKey.set(row.key, (totalsByKey.get(row.key) ?? 0) + row.value)
  }
  const ranked = [...totalsByKey.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key)
  const top = ranked.slice(0, limit)
  const topSet = new Set(top)
  const buckets = ranked.length > limit ? [...top, OTHER_MODEL_KEY] : [...top]

  const byDate = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const key = topSet.has(row.key) ? row.key : OTHER_MODEL_KEY
    const bucket = byDate.get(row.date) ?? new Map<string, number>()
    bucket.set(key, (bucket.get(key) ?? 0) + row.value)
    byDate.set(row.date, bucket)
  }

  const series: ModelStackDatum[] = lastDateKeys(days).map((date) => {
    const bucket = byDate.get(date)
    const datum: ModelStackDatum = { date }
    for (const key of buckets) {
      datum[key] = bucket?.get(key) ?? 0
    }
    return datum
  })

  return { series, models: buckets }
}

/** Minimal per-device series shape the fleet stack helpers need. */
export interface FleetStackDevice {
  key: string
  daily: DailyUsage[]
  dailyByModel: DailyUsageByModel[]
  dailyCost: DailyCost[]
}

/**
 * Pivots fleet-wide daily rows into one stacked-bar datum per calendar day
 * keyed by device — the trend chart's "by device" token view. Device count is
 * small by nature, so no top-N bucketing (limit = Infinity).
 */
export function denseFleetTokenStackSeries(devices: FleetStackDevice[], days: number): ModelStackSeries {
  return pivotDenseStack(
    devices.flatMap(device => device.daily.map(row => ({ date: row.date, key: device.key, value: row.totalTokens }))),
    days,
    Infinity,
  )
}

/** Cost twin of denseFleetTokenStackSeries — sums each device's daily costUsd. */
export function denseFleetCostStackSeries(devices: FleetStackDevice[], days: number): ModelStackSeries {
  return pivotDenseStack(
    devices.flatMap(device => device.dailyCost.map(row => ({ date: row.date, key: device.key, value: row.costUsd }))),
    days,
    Infinity,
  )
}

/** Combined device × model token stack ("which models on which device"), keyed `${deviceKey}::${modelId}` with top-N bucketing. */
export function denseFleetModelTokenStackSeries(devices: FleetStackDevice[], days: number, limit = 6): ModelStackSeries {
  return pivotDenseStack(
    devices.flatMap(device => device.dailyByModel.map(row => ({ date: row.date, key: `${device.key}::${row.modelId}`, value: row.totalTokens }))),
    days,
    limit,
  )
}

/** Cost twin of denseFleetModelTokenStackSeries, stacking costUsd per device × model. */
export function denseFleetModelCostStackSeries(devices: FleetStackDevice[], days: number, limit = 6): ModelStackSeries {
  return pivotDenseStack(
    devices.flatMap(device => device.dailyCost.map(row => ({ date: row.date, key: `${device.key}::${row.modelId}`, value: row.costUsd }))),
    days,
    limit,
  )
}

/** Groups the daily-by-model series by weekday, for the "which model" line in the by-weekday pattern chart tooltip. */
export function modelBreakdownByWeekday(dailyByModel: DailyUsageByModel[], limit = 4): Map<number, ModelTokenShare[]> {
  const totalsByWeekday = new Map<number, Map<string, number>>()
  for (const row of dailyByModel) {
    const weekdayIndex = weekdayIndexFromDateKey(row.date)
    const totals = totalsByWeekday.get(weekdayIndex) ?? new Map<string, number>()
    totals.set(row.modelId, (totals.get(row.modelId) ?? 0) + row.totalTokens)
    totalsByWeekday.set(weekdayIndex, totals)
  }
  const result = new Map<number, ModelTokenShare[]>()
  for (const [weekdayIndex, totals] of totalsByWeekday) {
    const entries: ModelTokenShare[] = Array.from(totals.entries()).map(([modelId, totalTokens]) => ({ modelId, totalTokens }))
    result.set(weekdayIndex, topModelShares(entries, limit))
  }
  return result
}
