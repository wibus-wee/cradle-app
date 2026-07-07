// Shared local-date helpers for the Usage feature. All usage timestamps are
// bucketed by local calendar day on the server (see usage/service.ts), so the
// renderer must key off local dates too, never UTC, or cells shift by a day.

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export type WeekdayLabel = typeof WEEKDAY_LABELS[number]

export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayDateKey(): string {
  return toDateKey(new Date())
}

/** Builds the last `days` calendar-day keys ending today, oldest first. */
export function lastDateKeys(days: number): string[] {
  const today = new Date()
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    keys.push(toDateKey(d))
  }
  return keys
}

export function weekdayIndexFromDateKey(dateKey: string): number {
  // Parse as local date (not UTC) to match toDateKey's local semantics.
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day).getDay()
}

export function weekdayLabel(index: number): WeekdayLabel {
  return WEEKDAY_LABELS[index] ?? 'Sun'
}

/**
 * Fills gaps in a sparse date-keyed series so consumers can safely slice by
 * day count. The usage API only returns rows for days that had activity, so
 * without densification a "last 30 days" slice could actually span months.
 */
export function buildDenseDailySeries<T extends { date: string }>(
  data: T[],
  days: number,
  makeEmpty: (date: string) => T,
): T[] {
  const lookup = new Map(data.map(row => [row.date, row]))
  return lastDateKeys(days).map(dateKey => lookup.get(dateKey) ?? makeEmpty(dateKey))
}
