import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { observabilityEvents, observabilityIncidents } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../../app'
import { db, shutdownInfra } from '../../infra'
import { pruneObservabilityEvents } from './service'

const dataDirs: string[] = []

afterEach(() => {
  shutdownInfra()
  for (const directory of dataDirs) {
    rmSync(directory, { recursive: true, force: true })
  }
  dataDirs.length = 0
  delete process.env.CRADLE_DATA_DIR
  delete process.env.CRADLE_OBSERVABILITY_EVENT_RETENTION_DAYS
})

const DAY_MS = 24 * 60 * 60 * 1000

async function seed(): Promise<void> {
  process.env.CRADLE_DATA_DIR = mkdtempSync(join(tmpdir(), 'cradle-observability-retention-'))
  dataDirs.push(process.env.CRADLE_DATA_DIR)
  await createServerApp()
}

function insertEvent(input: { recordedAt: number, occurredAt?: number }): string {
  const id = randomUUID()
  db().insert(observabilityEvents).values({
    id,
    schemaVersion: 1,
    source: 'test',
    code: 'test_event',
    severity: 'info',
    category: 'test',
    message: 'retention probe',
    occurredAt: input.occurredAt ?? input.recordedAt,
    recordedAt: input.recordedAt,
  }).run()
  return id
}

describe('pruneObservabilityEvents', () => {
  it('deletes events recorded before the retention window', async () => {
    await seed()
    const now = Date.now()
    insertEvent({ recordedAt: now - 15 * DAY_MS })
    insertEvent({ recordedAt: now - 13 * DAY_MS })

    const result = pruneObservabilityEvents(now)

    expect(result.prunedEvents).toBe(1)
    const remaining = db().select().from(observabilityEvents).all()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.recordedAt).toBe(now - 13 * DAY_MS)
  })

  it('keeps incidents and nulls their lastEventId instead of failing the delete', async () => {
    await seed()
    const now = Date.now()
    const oldEventId = insertEvent({ recordedAt: now - 15 * DAY_MS })
    db().insert(observabilityIncidents).values({
      id: randomUUID(),
      dedupeKey: `dedupe-${randomUUID()}`,
      code: 'test_event',
      severity: 'error',
      status: 'open',
      source: 'test',
      message: 'incident',
      firstOccurredAt: now - 15 * DAY_MS,
      lastOccurredAt: now - 15 * DAY_MS,
      lastRecordedAt: now - 15 * DAY_MS,
      lastEventId: oldEventId,
    }).run()

    const result = pruneObservabilityEvents(now)

    expect(result.prunedEvents).toBe(1)
    const incidents = db().select().from(observabilityIncidents).all()
    // The aggregate is the durable signal: it must survive event pruning, with
    // the set-null FK clearing the dangling event pointer.
    expect(incidents).toHaveLength(1)
    expect(incidents[0]!.lastEventId).toBeNull()
    expect(db().select().from(observabilityEvents).where(eq(observabilityEvents.id, oldEventId)).all())
      .toHaveLength(0)
  })

  it('does nothing when retention is disabled', async () => {
    process.env.CRADLE_OBSERVABILITY_EVENT_RETENTION_DAYS = '0'
    await seed()
    const now = Date.now()
    insertEvent({ recordedAt: now - 365 * DAY_MS })

    const result = pruneObservabilityEvents(now)

    expect(result.prunedEvents).toBe(0)
    expect(db().select().from(observabilityEvents).all()).toHaveLength(1)
  })
})
