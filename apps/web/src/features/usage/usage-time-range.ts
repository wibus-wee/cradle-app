// Client-side time range selector shared by the trend chart, hero cards, and
// insight copy. The daily/cost endpoints already return up to 365 days in one
// call, so narrowing the range is just a slice — no extra network round trip.

export type UsageRangeKey = '7d' | '30d' | '90d' | '1y'

export interface UsageRangeOption {
  key: UsageRangeKey
  days: number
  label: string
}

// Conventional range abbreviations (matches Vercel/Linear analytics
// surfaces) — intentionally not localized, same as "7D/30D/90D/1Y" reads
// everywhere.
export const USAGE_RANGE_OPTIONS: UsageRangeOption[] = [
  { key: '7d', days: 7, label: '7D' },
  { key: '30d', days: 30, label: '30D' },
  { key: '90d', days: 90, label: '90D' },
  { key: '1y', days: 365, label: '1Y' },
]

const USAGE_RANGE_KEYS = new Set<UsageRangeKey>(USAGE_RANGE_OPTIONS.map(option => option.key))

export function isUsageRangeKey(value: unknown): value is UsageRangeKey {
  return typeof value === 'string' && USAGE_RANGE_KEYS.has(value as UsageRangeKey)
}

export function rangeDays(range: UsageRangeKey): number {
  return USAGE_RANGE_OPTIONS.find(option => option.key === range)?.days ?? 30
}
