export const usageRanges = [
  { days: 7, key: '7d', label: '7D' },
  { days: 30, key: '30d', label: '30D' },
  { days: 90, key: '90d', label: '90D' },
  { days: 365, key: '1y', label: '1Y' },
] as const

export type UsageRange = typeof usageRanges[number]['key']

export const DEFAULT_USAGE_RANGE: UsageRange = '30d'

export function isUsageRange(value: string | null): value is UsageRange {
  return usageRanges.some(option => option.key === value)
}

export function usageRangeDays(range: UsageRange): number {
  return usageRanges.find(option => option.key === range)?.days ?? 30
}
