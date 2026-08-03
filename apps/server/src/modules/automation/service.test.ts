// Module tests for automation scheduling invariants: RRULE next-occurrence
// computation in the definition timezone (including DST wall-clock stability),
// misfire policy handling, definition validation, and scheduled-run dedup in
// enqueueDueRuns. No run is executed, so the Chat Runtime seam stays untouched.

import { automationDefinitions, automationEvents, automationRuns } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '../../infra'
import type { AutomationTrigger } from './scheduler'
import { getNextOccurrence, listDueOccurrences } from './scheduler'
import type { AutomationRecipe } from './service'
import * as Automation from './service'

const shanghaiWeeklyMonday: AutomationTrigger = {
  type: 'rrule',
  rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
  timezone: 'Asia/Shanghai',
}

function unix(iso: string): number {
  return Date.parse(iso) / 1000
}

function baseRecipe(overrides: Partial<AutomationRecipe> = {}): AutomationRecipe {
  return {
    kind: 'agent_task',
    prompt: 'Write the report.',
    inputs: [],
    artifactRequests: [],
    providerTargetId: 'profile-automation',
    ...overrides,
  }
}

describe('automation scheduler', () => {
  it('computes the next occurrence in the trigger timezone as UTC unix seconds', () => {
    // 2026-05-17 is a Sunday; Monday 09:00 Asia/Shanghai is 01:00 UTC.
    const next = getNextOccurrence(shanghaiWeeklyMonday, unix('2026-05-17T00:00:00.000Z'))
    expect(next).toBe(unix('2026-05-18T01:00:00.000Z'))

    // Asking from exactly the occurrence must move to the following week,
    // otherwise refreshDefinitionSchedule would re-arm the same occurrence.
    const following = getNextOccurrence(shanghaiWeeklyMonday, unix('2026-05-18T01:00:00.000Z'))
    expect(following).toBe(unix('2026-05-25T01:00:00.000Z'))
  })

  it('keeps occurrences on local wall-clock time across a DST transition', () => {
    const nyDailyNine: AutomationTrigger = {
      type: 'rrule',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
      timezone: 'America/New_York',
    }
    // US DST ends 2026-11-01: 09:00 local is 13:00 UTC before and 14:00 UTC after.
    const due = listDueOccurrences(nyDailyNine, {
      windowStart: unix('2026-10-31T00:00:00.000Z'),
      windowEnd: unix('2026-11-02T23:00:00.000Z'),
    })
    expect(due.map(occurrence => occurrence.scheduledFor)).toEqual([
      unix('2026-10-31T13:00:00.000Z'),
      unix('2026-11-01T14:00:00.000Z'),
      unix('2026-11-02T14:00:00.000Z'),
    ])
  })

  it('applies misfire policy and limit to due occurrences', () => {
    const window = {
      windowStart: unix('2026-05-04T00:00:00.000Z'),
      windowEnd: unix('2026-05-26T00:00:00.000Z'),
    }

    const allMissed = listDueOccurrences(shanghaiWeeklyMonday, window)
    expect(allMissed.map(occurrence => occurrence.scheduledFor)).toEqual([
      unix('2026-05-04T01:00:00.000Z'),
      unix('2026-05-11T01:00:00.000Z'),
      unix('2026-05-18T01:00:00.000Z'),
      unix('2026-05-25T01:00:00.000Z'),
    ])
    expect(allMissed[0].occurrenceKey).toBe(`scheduled:${allMissed[0].scheduledFor}`)

    const latestOnly = listDueOccurrences(
      { ...shanghaiWeeklyMonday, misfirePolicy: 'run_latest' },
      window,
    )
    expect(latestOnly.map(occurrence => occurrence.scheduledFor)).toEqual([
      unix('2026-05-25T01:00:00.000Z'),
    ])

    const limited = listDueOccurrences(shanghaiWeeklyMonday, { ...window, limit: 2 })
    expect(limited).toHaveLength(2)
  })
})

describe('automation service', () => {
  afterEach(() => {
    db().delete(automationEvents).run()
    db().delete(automationRuns).run()
    db().delete(automationDefinitions).run()
  })

  it('rejects incompatible execution policies at definition time', () => {
    expect(() =>
      Automation.create({
        title: 'Bad policies',
        trigger: shanghaiWeeklyMonday,
        recipe: baseRecipe({
          sessionPolicy: 'heartbeat',
          isolationPolicy: 'worktree_per_run',
        }),
      })).toThrow(expect.objectContaining({ code: 'automation_incompatible_execution_policies' }))
    expect(db().select().from(automationDefinitions).all()).toHaveLength(0)
  })

  it('arms nextRunAt on create and clears it while disabled', () => {
    const created = Automation.create({
      title: 'Weekly report',
      trigger: shanghaiWeeklyMonday,
      recipe: baseRecipe(),
    })
    expect(created.nextRunAt).toEqual(expect.any(Number))
    expect(created.nextRunAt!).toBeGreaterThan(Math.floor(Date.now() / 1000))

    const disabled = Automation.setEnabled(created.id, false)
    expect(disabled).toEqual(expect.objectContaining({ enabled: false, nextRunAt: null }))

    const reenabled = Automation.setEnabled(created.id, true)
    expect(reenabled.nextRunAt).toEqual(expect.any(Number))
    expect(reenabled.nextRunAt!).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('enqueues one run per due occurrence, advances the schedule, and dedupes replays', () => {
    const created = Automation.create({
      title: 'Weekly report',
      trigger: shanghaiWeeklyMonday,
      recipe: baseRecipe(),
    })
    const occurrenceAt = unix('2026-05-18T01:00:00.000Z')
    const now = occurrenceAt + 300
    db()
      .update(automationDefinitions)
      .set({ nextRunAt: occurrenceAt })
      .where(eq(automationDefinitions.id, created.id))
      .run()

    const runs = Automation.enqueueDueRuns({ now })
    expect(runs).toEqual([
      expect.objectContaining({
        automationDefinitionId: created.id,
        triggerType: 'scheduled',
        status: 'queued',
        occurrenceKey: `scheduled:${occurrenceAt}`,
        scheduledFor: occurrenceAt,
      }),
    ])
    expect(Automation.get(created.id).nextRunAt).toBe(unix('2026-05-25T01:00:00.000Z'))

    // A crash-replay of the same window must not create a duplicate run.
    db()
      .update(automationDefinitions)
      .set({ nextRunAt: occurrenceAt })
      .where(eq(automationDefinitions.id, created.id))
      .run()
    expect(Automation.enqueueDueRuns({ now })).toEqual([])
    expect(
      db()
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.automationDefinitionId, created.id))
        .all(),
    ).toHaveLength(1)
  })

  it('never enqueues scheduled runs for disabled definitions', () => {
    const created = Automation.create({
      title: 'Disabled report',
      trigger: shanghaiWeeklyMonday,
      recipe: baseRecipe(),
    })
    const occurrenceAt = unix('2026-05-18T01:00:00.000Z')
    Automation.setEnabled(created.id, false)
    db()
      .update(automationDefinitions)
      .set({ nextRunAt: occurrenceAt })
      .where(eq(automationDefinitions.id, created.id))
      .run()

    expect(Automation.enqueueDueRuns({ now: occurrenceAt + 300 })).toEqual([])
    expect(
      db()
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.automationDefinitionId, created.id))
        .all(),
    ).toHaveLength(0)
  })
})
