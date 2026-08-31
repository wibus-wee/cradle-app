import type { UsageViewProps } from './usage-view-contract'

export const usageFixture: UsageViewProps = {
  daily: [
    { completionTokens: 18_400, count: 12, date: '2026-07-27', promptTokens: 44_200, totalTokens: 62_600 },
    { completionTokens: 25_100, count: 16, date: '2026-07-28', promptTokens: 70_300, totalTokens: 95_400 },
    { completionTokens: 12_200, count: 8, date: '2026-07-29', promptTokens: 31_800, totalTokens: 44_000 },
  ],
  onRangeChange: () => {},
  range: '30d',
  stats: {
    activeDays: 18,
    avgDailyTokens: 72_400,
    currentStreak: 6,
    longestStreak: 14,
    peakDay: { date: '2026-07-18', totalTokens: 198_200 },
    todayTokens: 44_000,
  },
  summary: {
    byAgent: [],
    byModel: [
      { count: 114, modelId: 'claude-sonnet-4-5', totalTokens: 1_240_000 },
      { count: 86, modelId: 'gpt-5.2-codex', totalTokens: 820_000 },
    ],
    byProviderTarget: [],
    totalCompletionTokens: 620_000,
    totalPromptTokens: 1_820_000,
    totalTokens: 2_440_000,
    totalTurns: 200,
  },
}
