import type { GetUsageDailyResponse } from '@/api-gen'

type DailyUsage = GetUsageDailyResponse[number]

export function formatUsageNumber(value: number): string {
  return value.toLocaleString()
}

export function denseRecentUsageDays(
  daily: GetUsageDailyResponse,
  length = 14,
): DailyUsage[] {
  const byDate = new Map(daily.map(day => [day.date, day]))
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  return Array.from({ length }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (length - index - 1))
    const key = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')
    return byDate.get(key) ?? {
      completionTokens: 0,
      count: 0,
      date: key,
      promptTokens: 0,
      totalTokens: 0,
    }
  })
}
