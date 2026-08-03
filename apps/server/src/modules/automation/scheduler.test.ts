// Focused unit tests for RRULE schedule computation: timezone wall-clock
// interpretation, misfire policies, occurrence keys, limits, and DST safety.

import { describe, expect, it } from 'vitest'

import type { AutomationTrigger } from './scheduler'
import { getNextOccurrence, listDueOccurrences } from './scheduler'

function unix(iso: string): number {
  return Date.parse(iso) / 1000
}

const weeklyShanghai: AutomationTrigger = {
  type: 'rrule',
  rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
  timezone: 'Asia/Shanghai',
}

const dailyUtc: AutomationTrigger = {
  type: 'rrule',
  rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
  timezone: 'UTC',
}

describe('automation scheduler', () => {
  it('computes the next occurrence as trigger-timezone wall time converted to UTC seconds', () => {
    // Monday 2026-05-18 09:00 Asia/Shanghai (UTC+8) is 01:00 UTC.
    const next = getNextOccurrence(weeklyShanghai, unix('2026-05-17T00:00:00.000Z'))
    expect(next).toBe(unix('2026-05-18T01:00:00.000Z'))
  })

  it('returns null when the rule has no occurrence after the reference time', () => {
    const expired: AutomationTrigger = {
      type: 'rrule',
      rrule: 'FREQ=DAILY;UNTIL=20200101T000000Z',
      timezone: 'UTC',
    }
    expect(getNextOccurrence(expired, unix('2026-05-17T00:00:00.000Z'))).toBeNull()
  })

  it('lists every missed occurrence under the default skip policy with stable occurrence keys', () => {
    const due = listDueOccurrences(dailyUtc, {
      windowStart: unix('2026-05-18T00:00:00.000Z'),
      windowEnd: unix('2026-05-20T12:00:00.000Z'),
    })

    expect(due.map(occurrence => occurrence.scheduledFor)).toEqual([
      unix('2026-05-18T09:00:00.000Z'),
      unix('2026-05-19T09:00:00.000Z'),
      unix('2026-05-20T09:00:00.000Z'),
    ])
    for (const occurrence of due) {
      expect(occurrence.occurrenceKey).toBe(`scheduled:${occurrence.scheduledFor}`)
    }
  })

  it('collapses a missed backlog to the single latest occurrence under run_latest', () => {
    const due = listDueOccurrences(
      { ...dailyUtc, misfirePolicy: 'run_latest' },
      {
        windowStart: unix('2026-05-18T00:00:00.000Z'),
        windowEnd: unix('2026-05-20T12:00:00.000Z'),
      },
    )

    expect(due).toEqual([
      {
        occurrenceKey: `scheduled:${unix('2026-05-20T09:00:00.000Z')}`,
        scheduledFor: unix('2026-05-20T09:00:00.000Z'),
      },
    ])
  })

  it('caps returned occurrences at the requested limit', () => {
    const due = listDueOccurrences(dailyUtc, {
      windowStart: unix('2026-05-01T00:00:00.000Z'),
      windowEnd: unix('2026-05-10T00:00:00.000Z'),
      limit: 2,
    })

    expect(due.map(occurrence => occurrence.scheduledFor)).toEqual([
      unix('2026-05-01T09:00:00.000Z'),
      unix('2026-05-02T09:00:00.000Z'),
    ])
  })

  it('keeps the wall-clock time across a DST transition', () => {
    // Europe/Berlin switches to DST on 2026-03-29: 09:00 local moves from
    // 08:00 UTC (CET) to 07:00 UTC (CEST) while staying 09:00 on the wall.
    const dailyBerlin: AutomationTrigger = {
      type: 'rrule',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
      timezone: 'Europe/Berlin',
    }

    const due = listDueOccurrences(dailyBerlin, {
      windowStart: unix('2026-03-28T00:00:00.000Z'),
      windowEnd: unix('2026-03-31T00:00:00.000Z'),
    })

    expect(due.map(occurrence => occurrence.scheduledFor)).toEqual([
      unix('2026-03-28T08:00:00.000Z'),
      unix('2026-03-29T07:00:00.000Z'),
      unix('2026-03-30T07:00:00.000Z'),
    ])
  })
})
