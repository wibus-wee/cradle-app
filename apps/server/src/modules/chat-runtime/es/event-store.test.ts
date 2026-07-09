import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import { appendSessionEvent } from './event-store'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-es-store-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousDbPath = process.env.CRADLE_DB_PATH
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH

  try {
    return await callback()
  }
 finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CRADLE_DB_PATH', previousDbPath)
  }
}

describe('appendSessionEvent', () => {
  it('rejects stale expectedVersion values with a typed concurrency conflict', async () => {
    await withTempDataDir(() => {
      db().transaction((tx) => {
        const stored = appendSessionEvent(tx, {
          aggregateId: 'session-1',
          expectedVersion: 0,
          event: {
            type: 'TitleChanged',
            payload: {
              sessionId: 'session-1',
              title: 'First',
              titleSource: 'provider',
              updatedAt: 100,
            },
          },
        })
        expect(stored.version).toBe(1)
        expect(stored.payload.v).toBe(3)

        expect(() =>
          appendSessionEvent(tx, {
            aggregateId: 'session-1',
            expectedVersion: 0,
            event: {
              type: 'TitleChanged',
              payload: {
                sessionId: 'session-1',
                title: 'Stale',
                titleSource: 'provider',
                updatedAt: 101,
              },
            },
          })).toThrow(expect.objectContaining({
          code: 'chat_session_concurrency_conflict',
          status: 409,
          details: expect.objectContaining({
            kind: 'concurrency_conflict',
            aggregateId: 'session-1',
            expectedVersion: 0,
            actualVersion: 1,
          }),
        }))
      })
    })
  })
})
