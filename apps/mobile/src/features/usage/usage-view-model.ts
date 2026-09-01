import type {
  GetUsageDailyResponse,
  GetUsageStatsResponse,
  GetUsageSummaryResponse,
} from '@/api-gen'

import type { UsageRange } from './usage-range'
import { usageRanges } from './usage-range'

type DailyUsage = GetUsageDailyResponse[number]

export function formatUsageNumber(value: number): string {
  return value.toLocaleString()
}

export function createUsageReport(
  range: UsageRange,
  summary: GetUsageSummaryResponse,
  stats: GetUsageStatsResponse,
): string {
  const rangeLabel = usageRanges.find(option => option.key === range)?.label ?? range
  const sections = [
    [
      `Cradle Usage · ${rangeLabel}`,
      `${formatUsageNumber(summary.totalTokens)} tokens · ${formatUsageNumber(summary.totalTurns)} turns`,
      `Input: ${formatUsageNumber(summary.totalPromptTokens)}`,
      `Output: ${formatUsageNumber(summary.totalCompletionTokens)}`,
      `Today: ${formatUsageNumber(stats.todayTokens)}`,
      `Daily average: ${formatUsageNumber(stats.avgDailyTokens)}`,
      `Current streak: ${formatUsageNumber(stats.currentStreak)} days`,
    ].join('\n'),
  ]
  if (summary.byModel.length > 0) {
    sections.push([
      'Top models',
      ...summary.byModel
        .slice(0, 5)
        .map(model => `• ${model.modelId}: ${formatUsageNumber(model.totalTokens)}`),
    ].join('\n'))
  }
  if (summary.byProviderTarget.length > 0) {
    sections.push([
      'Top providers',
      ...summary.byProviderTarget
        .slice(0, 5)
        .map(provider => `• ${provider.providerTargetName ?? provider.providerTargetId}: ${formatUsageNumber(provider.totalTokens)}`),
    ].join('\n'))
  }
  return sections.join('\n\n')
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
