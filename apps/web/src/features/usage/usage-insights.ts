// Pure calculations that turn the raw daily series into the comparisons and
// call-outs the dashboard surfaces ("+23% vs last week", "busiest on
// Tuesdays"). Everything here is derived from real API data — no mocking.
import type { TFunction } from 'i18next'

import { buildDenseDailySeries, lastDateKeys, weekdayIndexFromDateKey } from './usage-date'
import { categoryColor } from './usage-palette'
import type { DailyCost, DailyUsage, DailyUsageByModel } from './use-usage-overview'

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
