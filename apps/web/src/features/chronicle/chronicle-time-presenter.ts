import type { TFunction } from 'i18next'
import { z } from 'zod'

type ChronicleTranslate = TFunction<'chronicle'>

const TimestampMsSchema = z.union([
  z.number().finite().transform(value => value < 1_000_000_000_000 ? value * 1000 : value),
  z.string()
    .transform(value => new Date(value).getTime())
    .pipe(z.number().finite()),
  z.null().transform(() => null),
])

export function formatChronicleDateTime(
  t: ChronicleTranslate,
  value: string | number | null,
): string {
  const time = TimestampMsSchema.parse(value)
  if (time === null) {
    return t('time.never')
  }

  return new Date(time).toLocaleString()
}

export function formatChronicleRelativeTime(
  t: ChronicleTranslate,
  value: string | number | null,
): string {
  const time = TimestampMsSchema.parse(value)
  if (time === null) {
    return t('time.never')
  }

  const diff = Date.now() - time
  const seconds = Math.max(0, Math.floor(diff / 1000))
  if (seconds < 60) {
    return t('time.justNow')
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return t('time.minutesAgo', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return t('time.hoursAgo', { count: hours })
  }
  const days = Math.floor(hours / 24)
  return t('time.daysAgo', { count: days })
}
