import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendRunSnapshotEvents, backendRunSnapshots } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import { getRuntimePerformanceOverview } from './performance'

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cradle-usage-performance-'))
  process.env.CRADLE_DATA_DIR = dataDir
})

afterEach(() => {
  shutdownInfra()
  rmSync(dataDir, { recursive: true, force: true })
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
})

describe('getRuntimePerformanceOverview', () => {
  it('aggregates completed run timings across runtimes and keeps missing first-token samples explicit', () => {
    const base = new Date(2026, 6, 29, 12).getTime()
    insertSample({ id: 'codex-1', runtimeKind: 'codex', startedAt: base, firstTokenMs: 100, durationMs: 1_000 })
    insertSample({ id: 'codex-2', runtimeKind: 'codex', startedAt: base + 60_000, firstTokenMs: 300, durationMs: 3_000 })
    insertSample({ id: 'kimi-1', runtimeKind: 'kimi', startedAt: base + 120_000, firstTokenMs: 200, durationMs: 2_000 })
    insertSample({ id: 'kimi-2', runtimeKind: 'kimi', startedAt: base + 180_000, firstTokenMs: null, durationMs: 4_000 })

    const result = getRuntimePerformanceOverview('2026-07-29', '2026-07-29')

    expect(result.summary).toEqual({
      sampleCount: 4,
      firstTokenSampleCount: 3,
      p50FirstTokenMs: 200,
      p95FirstTokenMs: 290,
      p50TotalDurationMs: 2_500,
      p95TotalDurationMs: 3_850,
    })
    expect(result.byRuntime).toEqual([
      expect.objectContaining({
        runtimeKind: 'codex',
        sampleCount: 2,
        firstTokenSampleCount: 2,
        p50FirstTokenMs: 200,
        p95TotalDurationMs: 2_900,
      }),
      expect.objectContaining({
        runtimeKind: 'kimi',
        sampleCount: 2,
        firstTokenSampleCount: 1,
        p50FirstTokenMs: 200,
        p95TotalDurationMs: 3_900,
      }),
    ])
    expect(result.daily).toHaveLength(2)
    expect(result.coverageStartedAt).toBe(base)
    expect(result.coverageEndedAt).toBe(base + 184_000)
  })
})

function insertSample(input: {
  id: string
  runtimeKind: string
  startedAt: number
  firstTokenMs: number | null
  durationMs: number
}): void {
  db().insert(backendRunSnapshots).values({
    id: input.id,
    schemaVersion: 1,
    traceId: input.id,
    runtimeKind: input.runtimeKind,
    status: 'complete',
    startedAt: input.startedAt,
    completedAt: input.startedAt + input.durationMs,
  }).run()
  if (input.firstTokenMs !== null) {
    db().insert(backendRunSnapshotEvents).values({
      id: `${input.id}:first-token`,
      snapshotId: input.id,
      seq: 0,
      phase: 'model_first_token_delta',
      occurredAt: input.startedAt + input.firstTokenMs,
    }).run()
  }
}
