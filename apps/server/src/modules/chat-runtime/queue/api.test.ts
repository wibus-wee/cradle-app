import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chatSessionQueueItems, sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import { toOpenCodeRuntimeNativeProviderTargetId } from '../../chat-runtime-providers/opencode/native-provider-target-id'
import { enqueueSessionQueueItem } from './api'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-queue-api-'))
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

function seedOpencodeSession(sessionId: string): void {
  db()
    .insert(sessions)
    .values({
      id: sessionId,
      title: 'Queue API Test',
      titleSource: 'initial',
      runtimeKind: 'opencode',
      createdAt: 100,
      updatedAt: 100,
    })
    .run()
}

describe('enqueueSessionQueueItem', () => {
  it('does not persist runtime-owned provider target ids into FK-backed queue rows', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-opencode-runtime-owned-queue'
      seedOpencodeSession(sessionId)

      const item = await enqueueSessionQueueItem(
        {
          sessionId,
          text: 'queued through opencode native provider',
          providerTargetId: toOpenCodeRuntimeNativeProviderTargetId('github-copilot'),
        },
        {
          scheduleSessionQueueDrain: () => {},
        },
      )

      expect(item.providerTargetId).toBeNull()
      expect(
        db()
          .select({ providerTargetId: chatSessionQueueItems.providerTargetId })
          .from(chatSessionQueueItems)
          .where(eq(chatSessionQueueItems.id, item.id))
          .get(),
      ).toEqual({ providerTargetId: null })
    })
  })
})
