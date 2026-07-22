import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chatSessionQueueItems, sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import { toOpenCodeRuntimeNativeProviderTargetId } from '../../chat-runtime-providers/opencode/native-provider-target-id'
import { runRegistry } from '../run-registry'
import { liveRuntimeSessionRegistry } from '../runtime-live-session-registry'
import type { RuntimeSession } from '../runtime-provider-types'
import { getDefaultRuntimeSettings } from '../runtime-settings'
import { cancelSessionQueueItem, enqueueSessionQueueItem } from './api'
import { scheduleSessionQueueDrain } from './drain'

afterEach(() => {
  liveRuntimeSessionRegistry.clear()
  runRegistry.clearAll()
  vi.restoreAllMocks()
})

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

  it('keeps a submitted row pending when native cancellation is not confirmed', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-opencode-native-cancel'
      seedOpencodeSession(sessionId)
      runRegistry.setActiveRunIdForSession(sessionId, 'active-run')

      let submittedQueueItemId = ''
      liveRuntimeSessionRegistry.register({
        sessionId,
        runtimeKind: 'opencode',
        providerTargetId: null,
        readRuntimeSession: () => ({
          id: sessionId,
          chatSessionId: sessionId,
          providerTargetId: null,
          runtimeKind: 'opencode',
          providerSessionId: null,
          providerStateSnapshot: null,
        } satisfies RuntimeSession),
        updateRuntimeSettings: async () => undefined,
        submitNativeInput: async ({ queueItemId }) => {
          submittedQueueItemId = queueItemId
        },
        hasNativeInput: queueItemId => queueItemId === submittedQueueItemId,
        cancelNativeInput: async () => false,
      })

      const item = await enqueueSessionQueueItem(
        { sessionId, text: 'native submitted input' },
        { scheduleSessionQueueDrain: () => {} },
      )

      await expect(cancelSessionQueueItem(sessionId, item.id)).rejects.toMatchObject({
        code: 'chat_queue_native_cancel_failed',
      })
      expect(
        db()
          .select({ status: chatSessionQueueItems.status })
          .from(chatSessionQueueItems)
          .where(eq(chatSessionQueueItems.id, item.id))
          .get(),
      ).toEqual({ status: 'pending' })
    })
  })

  it('projects exact native terminal outcomes without creating queue runs', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-opencode-native-terminals'
      seedOpencodeSession(sessionId)
      const deps = { scheduleSessionQueueDrain: () => {} }
      const completed = await enqueueSessionQueueItem({ sessionId, text: 'completed' }, deps)
      const failed = await enqueueSessionQueueItem({ sessionId, text: 'failed' }, deps)
      const cancelled = await enqueueSessionQueueItem({ sessionId, text: 'cancelled' }, deps)
      const createQueuedRun = vi.fn(async () => ({ runId: 'unexpected-run' }))

      liveRuntimeSessionRegistry.markNativeInputsTerminal(sessionId, [
        { queueItemId: completed.id, outcome: 'completed' },
        { queueItemId: failed.id, outcome: 'failed' },
        { queueItemId: cancelled.id, outcome: 'cancelled' },
      ])
      scheduleSessionQueueDrain(sessionId, {
        hasActiveOrPendingRun: () => false,
        readSessionRuntimeSettings: () => getDefaultRuntimeSettings('opencode'),
        createQueuedRun,
        serializeError: error => ({
          text: error instanceof Error ? error.message : String(error),
          payload: { message: error instanceof Error ? error.message : String(error) },
        }),
      })

      await vi.waitFor(() => {
        const statuses = db()
          .select({ id: chatSessionQueueItems.id, status: chatSessionQueueItems.status })
          .from(chatSessionQueueItems)
          .all()
        expect(new Map(statuses.map(row => [row.id, row.status]))).toEqual(new Map([
          [completed.id, 'completed'],
          [failed.id, 'failed'],
          [cancelled.id, 'cancelled'],
        ]))
      })
      expect(createQueuedRun).not.toHaveBeenCalled()
    })
  })
})
