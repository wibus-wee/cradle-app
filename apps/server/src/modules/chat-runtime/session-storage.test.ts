import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  backendSessionBindings,
  blobs,
  chatMessageBlobRefs,
  chatMessagePayloads,
  messages,
  sessionEvents,
  sessions,
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { currentUnixSeconds } from '../../helpers/time'
import { db, shutdownInfra } from '../../infra'
import { putBlob, resolveBlobStorePath } from '../blob-store/service'
import { runRegistry } from './run-registry'
import { purgeSessionTranscript } from './session-storage'

const previousDataDir = process.env.CRADLE_DATA_DIR
const previousDbPath = process.env.CRADLE_DB_PATH
let dataDir: string

describe('chat runtime session storage', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-session-storage-'))
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_DB_PATH
    shutdownInfra()
    runRegistry.clearAll()
  })

  afterEach(() => {
    shutdownInfra()
    runRegistry.clearAll()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CRADLE_DB_PATH', previousDbPath)
  })

  it('preserves session metadata while removing transcript data and exclusive blobs', async () => {
    const sessionId = randomUUID()
    const messageId = randomUUID()
    const now = currentUnixSeconds()

    db().insert(sessions).values({
      id: sessionId,
      title: 'Keep this title',
      titleSource: 'user',
      runtimeKind: 'standard',
      pinned: 1,
      createdAt: now,
      updatedAt: now,
    }).run()
    db().insert(chatMessagePayloads).values({
      id: messageId,
      sessionId,
      content: 'private transcript',
      messageJson: JSON.stringify({ id: messageId, role: 'user', parts: [] }),
      createdAt: now,
      updatedAt: now,
    }).run()
    db().insert(messages).values({
      id: messageId,
      sessionId,
      role: 'user',
      status: 'complete',
      payloadId: messageId,
      createdAt: now,
      updatedAt: now,
    }).run()
    db().insert(sessionEvents).values({
      aggregateId: sessionId,
      version: 1,
      eventType: 'MessageAdded',
      payload: '{}',
      occurredAt: now,
    }).run()
    db().insert(backendSessionBindings).values({
      id: randomUUID(),
      chatSessionId: sessionId,
      runtimeKind: 'standard',
      backendSessionId: 'provider-session-1',
      createdAt: now,
      updatedAt: now,
    }).run()

    const blob = putBlob({ bytes: Buffer.from('private attachment'), mediaType: 'text/plain', d: db() })
    const blobPath = resolveBlobStorePath(blob.storagePath)
    db().insert(chatMessageBlobRefs).values({
      id: randomUUID(),
      sessionId,
      messageId,
      partPath: '/parts/0/url',
      kind: 'file',
      blobId: blob.id,
      createdAt: now,
    }).run()

    const result = await purgeSessionTranscript(sessionId)

    expect(result.sessionId).toBe(sessionId)
    expect(result.attachmentBytesFreed).toBe(blob.byteSize)
    expect(db().select().from(sessions).where(eq(sessions.id, sessionId)).get()).toMatchObject({
      title: 'Keep this title',
      pinned: 1,
    })
    expect(db().select().from(messages).where(eq(messages.sessionId, sessionId)).all()).toEqual([])
    expect(db().select().from(chatMessagePayloads).where(eq(chatMessagePayloads.sessionId, sessionId)).all()).toEqual([])
    expect(db().select().from(sessionEvents).where(eq(sessionEvents.aggregateId, sessionId)).all()).toEqual([])
    expect(db().select().from(backendSessionBindings).where(eq(backendSessionBindings.chatSessionId, sessionId)).all()).toEqual([])
    expect(db().select().from(blobs).where(eq(blobs.id, blob.id)).get()).toBeUndefined()
    expect(existsSync(blobPath)).toBe(false)
  })

  it('rejects cleanup before writing when the session has a pending run', async () => {
    const sessionId = randomUUID()
    const now = currentUnixSeconds()
    db().insert(sessions).values({
      id: sessionId,
      title: 'Pending session',
      titleSource: 'initial',
      runtimeKind: 'standard',
      createdAt: now,
      updatedAt: now,
    }).run()
    runRegistry.setPendingRun(sessionId, { cancelled: false })

    await expect(purgeSessionTranscript(sessionId)).rejects.toMatchObject({
      code: 'storage_session_active',
      status: 409,
    })
    expect(db().select().from(sessions).where(eq(sessions.id, sessionId)).get()).toBeDefined()
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
