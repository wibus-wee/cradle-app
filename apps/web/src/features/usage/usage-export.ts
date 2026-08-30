import { lastDateKeys, todayDateKey } from './usage-date'
import type { UsageRangeKey } from './usage-time-range'
import { rangeDays } from './usage-time-range'
import type { DailyCost, DailyUsage } from './use-usage-overview'

export function buildUsageCsv(
  daily: DailyUsage[],
  dailyCost: DailyCost[],
  range: UsageRangeKey,
): string {
  const includedDates = new Set(lastDateKeys(rangeDays(range)))
  const costByDate = new Map<string, number>()

  for (const entry of dailyCost) {
    if (includedDates.has(entry.date)) {
      costByDate.set(entry.date, (costByDate.get(entry.date) ?? 0) + entry.costUsd)
    }
  }

  const rows = daily
    .filter(entry => includedDates.has(entry.date))
    .toSorted((left, right) => left.date.localeCompare(right.date))
    .map(entry => [
      entry.date,
      entry.promptTokens,
      entry.completionTokens,
      entry.totalTokens,
      entry.count,
      (costByDate.get(entry.date) ?? 0).toFixed(6),
    ].join(','))

  return [
    'date,prompt_tokens,completion_tokens,total_tokens,turns,cost_usd',
    ...rows,
  ].join('\n')
}

export function downloadUsageCsv(csv: string, range: UsageRangeKey): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `cradle-usage-${range}-${todayDateKey()}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
