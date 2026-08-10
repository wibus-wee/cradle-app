import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions, stepUsage, usageLogs } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import {
  enqueueStepUsage,
  enqueueUsageLog,
  flushUsageWriteBehind,
} from './write-behind'

function restoreDataDir(previousDataDir: string | undefined): void {
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
}

function seedSession(sessionId: string): void {
  db().insert(sessions).values({
    id: sessionId,
    title: 'Usage write-behind test',
    runtimeKind: 'standard',
  }).run()
}

describe('usage write-behind', () => {
  it('keeps writes off the caller stack and flushes large queues in bounded batches', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-usage-write-behind-'))
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      seedSession('session-batched')
      for (let index = 0; index < 125; index += 1) {
        enqueueUsageLog({
          id: `usage-${index}`,
          sessionId: 'session-batched',
          modelId: 'test-model',
          promptTokens: index,
          completionTokens: 1,
          totalTokens: index + 1,
          createdAt: 1_700_000_000 + index,
        })
        enqueueStepUsage([{
          id: `step-${index}`,
          runId: 'run-batched',
          sessionId: 'session-batched',
          stepNumber: index,
          stepType: 'model',
          modelId: 'test-model',
          promptTokens: index,
          completionTokens: 1,
          totalTokens: index + 1,
          estimatedCostUsd: 0,
          createdAt: 1_700_000_000 + index,
        }])
      }

      expect(db().select().from(usageLogs).all()).toHaveLength(0)
      expect(db().select().from(stepUsage).all()).toHaveLength(0)

      flushUsageWriteBehind()

      expect(db().select().from(usageLogs).all()).toHaveLength(125)
      expect(db().select().from(stepUsage).all()).toHaveLength(125)
    }
    finally {
      shutdownInfra()
      restoreDataDir(previousDataDir)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('drains the old database journal before an environment-driven database switch', () => {
    const firstDataDir = mkdtempSync(join(tmpdir(), 'cradle-usage-first-'))
    const secondDataDir = mkdtempSync(join(tmpdir(), 'cradle-usage-second-'))
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = firstDataDir

    try {
      seedSession('session-first')
      enqueueUsageLog({
        id: 'usage-before-switch',
        sessionId: 'session-first',
        modelId: 'test-model',
        promptTokens: 10,
        completionTokens: 2,
        totalTokens: 12,
        createdAt: 1_700_000_000,
      })

      process.env.CRADLE_DATA_DIR = secondDataDir
      expect(db().select().from(usageLogs).all()).toHaveLength(0)

      process.env.CRADLE_DATA_DIR = firstDataDir
      expect(db().select().from(usageLogs).all()).toEqual([
        expect.objectContaining({ id: 'usage-before-switch', totalTokens: 12 }),
      ])
    }
    finally {
      shutdownInfra()
      restoreDataDir(previousDataDir)
      rmSync(firstDataDir, { recursive: true, force: true })
      rmSync(secondDataDir, { recursive: true, force: true })
    }
  })
})
