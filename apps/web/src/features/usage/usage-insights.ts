// Pure calculations that turn the raw daily series into the comparisons and
// call-outs the dashboard surfaces ("+23% vs last week", "busiest on
// Tuesdays"). Everything here is derived from real API data — no mocking.
import { buildDenseDailySeries, weekdayIndexFromDateKey } from './usage-date'
import type { DailyCost, DailyUsage } from './use-usage-overview'

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

export function denseCostSeries(dailyCost: DailyCost[], days: number): DailyCost[] {
  return buildDenseDailySeries(dailyCost, days, date => ({
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
