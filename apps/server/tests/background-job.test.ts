import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { shutdownInfra } from '../src/infra'
import {
  registerOwnerProjector,
  registerSourceAdapter,
  unregisterOwnerProjector,
  unregisterSourceAdapter,
} from '../src/modules/background-job/registry'
import * as BackgroundJob from '../src/modules/background-job/service'
import type {
  BackgroundJobSourceObservation,
  BackgroundJobStatus,
} from '../src/modules/background-job/types'

interface TestInfraEnv {
  dataDir?: string
  dbPath?: string
  migrationsDir?: string
}

function configureIsolatedTestInfra(dataDir: string): TestInfraEnv {
  const previous = {
    dataDir: process.env.CRADLE_DATA_DIR,
    dbPath: process.env.CRADLE_DB_PATH,
    migrationsDir: process.env.CRADLE_MIGRATIONS_DIR,
  }
  shutdownInfra()
  process.env.CRADLE_DATA_DIR = dataDir
  process.env.CRADLE_MIGRATIONS_DIR = resolve(process.cwd(), '../../packages/db/drizzle')
  delete process.env.CRADLE_DB_PATH
  return previous
}

function restoreTestInfra(previous: TestInfraEnv): void {
  shutdownInfra()
  for (const [key, value] of Object.entries({
    CRADLE_DATA_DIR: previous.dataDir,
    CRADLE_DB_PATH: previous.dbPath,
    CRADLE_MIGRATIONS_DIR: previous.migrationsDir,
  })) {
    if (value === undefined) {
      delete process.env[key]
    }
 else {
      process.env[key] = value
    }
  }
}

describe('background jobs', () => {
  it('reconciles durable source state and retries incomplete owner projection', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-background-job-'))
    const previousEnv = configureIsolatedTestInfra(dataDir)
    const sourceKind = 'background-job-test-source'
    const ownerNamespace = 'background-job-test-owner'
    const kind = 'projection-retry'
    let observation: BackgroundJobSourceObservation = { status: 'running' }
    let projectionAttempts = 0

    registerSourceAdapter({
      sourceKind,
      async read() {
        return observation
      },
    })
    registerOwnerProjector({
      ownerNamespace,
      kind,
      project(job) {
        projectionAttempts += 1
        if (projectionAttempts === 1) {
          throw new Error('temporary projection failure')
        }
        return { result: { projectedJobId: job.id } }
      },
    })

    try {
      const created = BackgroundJob.enqueue({
        ownerNamespace,
        ownerResourceType: 'fixture',
        ownerResourceId: 'fixture-1',
        kind,
        sourceKind,
        sourceRunId: 'source-run-1',
        status: 'running',
      })

      expect((await BackgroundJob.reconcileOne(created.id)).status).toBe('running')

      shutdownInfra()
      observation = {
        status: 'succeeded',
        result: { source: 'complete' },
        finishedAt: 100,
      }
      const firstProjection = await BackgroundJob.reconcileOne(created.id)
      expect(firstProjection).toMatchObject({
        status: 'succeeded',
        projectedAt: null,
        projectionAttempts: 1,
        projectionError: 'temporary projection failure',
      })

      shutdownInfra()
      const recovered = await BackgroundJob.reconcileOne(created.id)
      expect(recovered).toMatchObject({
        status: 'succeeded',
        projectionAttempts: 2,
        projectionError: null,
        result: { projectedJobId: created.id },
      })
      expect(recovered.projectedAt).not.toBeNull()
    }
 finally {
      unregisterOwnerProjector(ownerNamespace, kind)
      unregisterSourceAdapter(sourceKind)
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('cancels idempotently and ignores late source completion', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-background-job-'))
    const previousEnv = configureIsolatedTestInfra(dataDir)
    const sourceKind = 'background-job-cancel-source'
    const ownerNamespace = 'background-job-cancel-owner'
    const kind = 'cancel-race'
    let observation: BackgroundJobSourceObservation = { status: 'running' }
    let cancelCalls = 0
    const projectedStatuses: BackgroundJobStatus[] = []

    registerSourceAdapter({
      sourceKind,
      async read() {
        return observation
      },
      async cancel() {
        cancelCalls += 1
      },
    })
    registerOwnerProjector({
      ownerNamespace,
      kind,
      project(job) {
        projectedStatuses.push(job.status)
      },
    })

    try {
      const created = BackgroundJob.enqueue({
        ownerNamespace,
        ownerResourceType: 'fixture',
        ownerResourceId: 'fixture-2',
        kind,
        sourceKind,
        sourceRunId: 'source-run-2',
        status: 'running',
      })

      const cancelled = await BackgroundJob.cancel(created.id)
      const cancelledAgain = await BackgroundJob.cancel(created.id)
      expect(cancelled.status).toBe('cancelled')
      expect(cancelledAgain.status).toBe('cancelled')
      expect(cancelCalls).toBe(1)
      expect(projectedStatuses).toEqual(['cancelled'])

      observation = { status: 'succeeded', result: { late: true } }
      const reconciled = await BackgroundJob.reconcileOne(created.id)
      expect(reconciled.status).toBe('cancelled')
      expect(reconciled.result).toBeNull()
      expect(projectedStatuses).toEqual(['cancelled'])
    }
 finally {
      unregisterOwnerProjector(ownerNamespace, kind)
      unregisterSourceAdapter(sourceKind)
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
