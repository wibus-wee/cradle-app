import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessionEvents, sessions } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import { getMessageSnapshot } from './history-api'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-history-performance-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  process.env.CRADLE_DATA_DIR = dataDir
  try {
    return await callback()
  }
  finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
  }
}

describe('chat message history hot path', () => {
  it('reads the indexed latest revision without parsing historical event payloads', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-indexed-history-revision'
      db().insert(sessions).values({
        id: sessionId,
        title: 'Indexed history revision',
        titleSource: 'initial',
        runtimeKind: 'standard',
        createdAt: 100,
        updatedAt: 100,
      }).run()
      db().insert(sessionEvents).values([
        {
          aggregateId: sessionId,
          aggregateType: 'ChatSession',
          version: 1,
          eventType: 'TitleChanged',
          payload: '{malformed historical payload',
          occurredAt: 100,
        },
        {
          aggregateId: sessionId,
          aggregateType: 'ChatSession',
          version: 2_000,
          eventType: 'TitleChanged',
          payload: JSON.stringify({
            sessionId,
            title: 'Latest',
            titleSource: 'provider',
            updatedAt: 200,
          }),
          occurredAt: 200,
        },
      ]).run()

      await expect(getMessageSnapshot(sessionId)).resolves.toEqual({
        revision: 2_000,
        rows: [],
        nextCursor: null,
      })
    })
  })
})
