import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chatRuntimeAuthRecoveries, chatSessionQueueItems, sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import {
  cancelRuntimeAuthRecovery,
  readPendingRuntimeAuthRecovery,
  recordRuntimeAuthRecovery,
  retryRuntimeAuthRecovery,
} from './auth-recovery'
import { ProviderRuntimeError } from './runtime-provider-types'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) { delete process.env[name] }
  else { process.env[name] = previousValue }
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-auth-recovery-'))
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

function seedFailedInput(sessionId: string, queueItemId: string): void {
  db().insert(sessions).values({
    id: sessionId,
    title: 'Auth recovery test',
    titleSource: 'initial',
    runtimeKind: 'opencode',
    configJson: JSON.stringify({ accessMode: 'full-access', interactionMode: 'default' }),
    createdAt: 100,
    updatedAt: 100,
  }).run()
  db().insert(chatSessionQueueItems).values({
    id: queueItemId,
    sessionId,
    mode: 'steer',
    status: 'failed',
    text: 'retry this exact input',
    filesJson: JSON.stringify([{
      type: 'file',
      mediaType: 'text/plain',
      filename: 'notes.txt',
      url: 'data:text/plain;base64,bm90ZXM=',
    }]),
    contextPartsJson: JSON.stringify([{
      type: 'data-cradle-intent',
      intentId: 'review',
      name: 'Review',
      label: 'Review changes',
      prompt: 'Review the current changes.',
    }]),
    providerTargetId: null,
    modelId: 'gpt-test',
    thinkingEffort: 'high',
    runtimeSettingsJson: JSON.stringify({ accessMode: 'approval-required', interactionMode: 'plan' }),
    position: 1,
    createdAt: 100,
    updatedAt: 100,
  }).run()
}

function authRequiredError(): ProviderRuntimeError {
  return new ProviderRuntimeError({
    _tag: 'auth_required',
    provider: 'acp',
    methods: [{ id: 'login', name: 'Provider login', kind: 'agent', status: 'supported' }],
    configurationTarget: { namespace: 'acp', resourceId: 'remote-agent' },
  })
}

afterEach(() => shutdownInfra())

describe('runtime authentication recovery', () => {
  it('records only actionable authentication failures', async () => {
    await withTempDataDir(() => {
      seedFailedInput('session-auth-record', 'queue-auth-record')
      expect(recordRuntimeAuthRecovery({
        error: authRequiredError(),
        sessionId: 'session-auth-record',
        queueItemId: 'queue-auth-record',
        runtimeKind: 'opencode',
      })).toBe(true)
      expect(readPendingRuntimeAuthRecovery('session-auth-record')).toMatchObject({
        queueItemId: 'queue-auth-record',
        provider: 'acp',
        configurationTarget: { namespace: 'acp', resourceId: 'remote-agent' },
      })

      expect(recordRuntimeAuthRecovery({
        error: new ProviderRuntimeError({ _tag: 'auth_failed', provider: 'acp' }),
        sessionId: 'session-auth-record',
        queueItemId: 'queue-auth-record',
        runtimeKind: 'opencode',
      })).toBe(false)
    })
  })

  it('retries the complete failed payload and resolves the recovery', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-auth-retry'
      const originalId = 'queue-auth-retry'
      seedFailedInput(sessionId, originalId)
      recordRuntimeAuthRecovery({
        error: authRequiredError(),
        sessionId,
        queueItemId: originalId,
        runId: 'run-auth-retry',
        runtimeKind: 'opencode',
      })
      const scheduled: string[] = []

      const result = await retryRuntimeAuthRecovery(sessionId, id => scheduled.push(id))
      const retry = db().select().from(chatSessionQueueItems).where(eq(chatSessionQueueItems.id, result.queueItemId)).get()

      expect(retry).toMatchObject({
        sessionId,
        mode: 'steer',
        status: 'pending',
        text: 'retry this exact input',
        modelId: 'gpt-test',
        thinkingEffort: 'high',
      })
      expect(retry?.filesJson).toBe(db().select().from(chatSessionQueueItems).where(eq(chatSessionQueueItems.id, originalId)).get()?.filesJson)
      expect(retry?.contextPartsJson).toBe(db().select().from(chatSessionQueueItems).where(eq(chatSessionQueueItems.id, originalId)).get()?.contextPartsJson)
      expect(JSON.parse(retry!.runtimeSettingsJson)).toMatchObject({ accessMode: 'approval-required', interactionMode: 'plan' })
      expect(scheduled).toEqual([sessionId])
      expect(readPendingRuntimeAuthRecovery(sessionId)).toBeNull()
      expect(db().select().from(chatRuntimeAuthRecoveries).where(eq(chatRuntimeAuthRecoveries.queueItemId, originalId)).get())
        .toMatchObject({ status: 'resolved', retryQueueItemId: result.queueItemId })
    })
  })

  it('dismisses a pending recovery without creating another queue item', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-auth-cancel'
      const queueItemId = 'queue-auth-cancel'
      seedFailedInput(sessionId, queueItemId)
      recordRuntimeAuthRecovery({ error: authRequiredError(), sessionId, queueItemId, runtimeKind: 'opencode' })

      expect(cancelRuntimeAuthRecovery(sessionId)).toEqual({ ok: true })
      expect(readPendingRuntimeAuthRecovery(sessionId)).toBeNull()
      expect(db().select().from(chatSessionQueueItems).all()).toHaveLength(1)
    })
  })

  it('claims a recovery before enqueueing so concurrent retries cannot duplicate the input', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-auth-concurrent'
      const queueItemId = 'queue-auth-concurrent'
      seedFailedInput(sessionId, queueItemId)
      recordRuntimeAuthRecovery({ error: authRequiredError(), sessionId, queueItemId, runtimeKind: 'opencode' })

      const results = await Promise.allSettled([
        retryRuntimeAuthRecovery(sessionId, () => {}),
        retryRuntimeAuthRecovery(sessionId, () => {}),
      ])

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
      expect(db().select().from(chatSessionQueueItems).all()).toHaveLength(2)
    })
  })
})
