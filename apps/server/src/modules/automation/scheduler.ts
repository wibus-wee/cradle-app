import type { rrulestr as parseRRuleString } from 'rrule'
import * as rrulePackage from 'rrule'

type RRulePackageShape = typeof rrulePackage & {
  default?: {
    rrulestr?: typeof parseRRuleString
  }
}

const loadedRRulePackage = rrulePackage as RRulePackageShape
const rrulestr = loadedRRulePackage.rrulestr ?? loadedRRulePackage.default?.rrulestr

if (!rrulestr) {
  throw new Error('rrule package does not expose rrulestr')
}

export interface AutomationTrigger {
  type: 'rrule'
  rrule: string
  timezone: string
  misfirePolicy?: 'skip' | 'run_latest'
}

export interface DueOccurrence {
  occurrenceKey: string
  scheduledFor: number
}

function dateFromUnixSeconds(value: number): Date {
  return new Date(value * 1000)
}

function getZonedDateParts(value: Date, timezone: string): {
  day: number
  hour: number
  minute: number
  month: number
  second: number
  year: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).formatToParts(value)
  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  )

  return {
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    month: values.month,
    second: values.second,
    year: values.year,
  }
}

function floatingDateFromUnixSeconds(value: number, timezone: string): Date {
  const parts = getZonedDateParts(dateFromUnixSeconds(value), timezone)
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second))
}

function unixSecondsFromFloatingDate(value: Date, timezone: string): number {
  const wallAsUtc = Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
  )

  let guess = wallAsUtc
  for (let index = 0; index < 3; index++) {
    const zonedParts = getZonedDateParts(new Date(guess), timezone)
    const zonedAsUtc = Date.UTC(
      zonedParts.year,
      zonedParts.month - 1,
      zonedParts.day,
      zonedParts.hour,
      zonedParts.minute,
      zonedParts.second,
    )
    const offset = zonedAsUtc - guess
    const nextGuess = wallAsUtc - offset
    if (nextGuess === guess) {
      break
    }
    guess = nextGuess
  }

  return Math.floor(guess / 1000)
}

function parseRule(trigger: AutomationTrigger, windowStart: number) {
  return rrulestr(trigger.rrule, {
    dtstart: floatingDateFromUnixSeconds(windowStart, trigger.timezone),
  })
}

export function getNextOccurrence(trigger: AutomationTrigger, afterUnixSeconds: number): number | null {
  const rule = parseRule(trigger, afterUnixSeconds)
  const next = rule.after(floatingDateFromUnixSeconds(afterUnixSeconds, trigger.timezone), false)
  return next ? unixSecondsFromFloatingDate(next, trigger.timezone) : null
}

export function listDueOccurrences(
  trigger: AutomationTrigger,
  input: { windowStart: number, windowEnd: number, limit?: number },
): DueOccurrence[] {
  const limit = input.limit ?? 25
  const rule = parseRule(trigger, input.windowStart)
  const dates = rule.between(
    floatingDateFromUnixSeconds(input.windowStart, trigger.timezone),
    floatingDateFromUnixSeconds(input.windowEnd, trigger.timezone),
    true,
  )
  const selected = trigger.misfirePolicy === 'run_latest' && dates.length > 1
    ? dates.slice(-1)
    : dates

  return selected.slice(0, limit).map(date => ({
    occurrenceKey: `scheduled:${unixSecondsFromFloatingDate(date, trigger.timezone)}`,
    scheduledFor: unixSecondsFromFloatingDate(date, trigger.timezone),
  }))
}
