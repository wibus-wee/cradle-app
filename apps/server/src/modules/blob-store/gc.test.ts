import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  blobs,
  chatMessageBlobRefs,
  chatMessagePayloads,
  messages,
  sessions,
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { currentUnixSeconds } from '../../helpers/time'
import { db, shutdownInfra } from '../../infra'
import { collectUnreferencedBlobs } from './gc'
import { putBlob, resolveBlobStorePath } from './service'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-blob-gc-'))
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

function seedSession(sessionId: string): void {
  const now = currentUnixSeconds()
  db().insert(sessions).values({
    id: sessionId,
    title: 'Blob GC Test',
    titleSource: 'initial',
    runtimeKind: 'standard',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedMessage(input: { sessionId: string, messageId: string }): void {
  const now = currentUnixSeconds()
  db().insert(chatMessagePayloads).values({
    id: input.messageId,
    sessionId: input.sessionId,
    content: 'gc',
    messageJson: JSON.stringify({ id: input.messageId, role: 'user', parts: [] }),
    createdAt: now,
    updatedAt: now,
  }).run()
  db().insert(messages).values({
    id: input.messageId,
    sessionId: input.sessionId,
    role: 'user',
    status: 'complete',
    payloadId: input.messageId,
    createdAt: now,
    updatedAt: now,
  }).run()
}

function insertRef(input: {
  sessionId: string
  messageId: string
  blobId: string
  partPath: string
  kind?: 'file' | 'tool_input' | 'tool_output'
  createdAt?: number
}): string {
  const id = randomUUID()
  db().insert(chatMessageBlobRefs).values({
    id,
    sessionId: input.sessionId,
    messageId: input.messageId,
    partPath: input.partPath,
    kind: input.kind ?? 'file',
    blobId: input.blobId,
    createdAt: input.createdAt ?? currentUnixSeconds(),
  }).run()
  return id
}

function backdateBlob(blobId: string, createdAt: number): void {
  db().update(blobs).set({ createdAt }).where(eq(blobs.id, blobId)).run()
}

function backdateRef(refId: string, createdAt: number): void {
  db().update(chatMessageBlobRefs).set({ createdAt }).where(eq(chatMessageBlobRefs.id, refId)).run()
}

describe('blob-store gc', () => {
  it('collects a blob with no refs older than the grace period', async () => {
    await withTempDataDir(async () => {
      const record = await putBlob({ bytes: Buffer.from('orphan-old'), mediaType: 'text/plain', d: db() })
      const path = resolveBlobStorePath(record.storagePath)
      backdateBlob(record.id, currentUnixSeconds() - 7200)

      const result = await collectUnreferencedBlobs()

      expect(result.blobsCollected).toBe(1)
      expect(result.bytesFreed).toBe(record.byteSize)
      expect(db().select().from(blobs).where(eq(blobs.id, record.id)).get()).toBeUndefined()
      expect(existsSync(path)).toBe(false)
    })
  })

  it('does not collect a blob with no refs created within the grace period', async () => {
    await withTempDataDir(async () => {
      const record = await putBlob({ bytes: Buffer.from('orphan-fresh'), mediaType: 'text/plain', d: db() })
      const path = resolveBlobStorePath(record.storagePath)

      const result = await collectUnreferencedBlobs()

      expect(result.blobsCollected).toBe(0)
      expect(db().select().from(blobs).where(eq(blobs.id, record.id)).get()).toBeDefined()
      expect(existsSync(path)).toBe(true)
    })
  })

  it('does not allow configuration to shorten the one-hour safety window', async () => {
    await withTempDataDir(async () => {
      const previousGrace = process.env.CRADLE_BLOB_GC_GRACE_SECONDS
      process.env.CRADLE_BLOB_GC_GRACE_SECONDS = '1'
      try {
        const record = putBlob({
          bytes: Buffer.from('minimum-grace'),
          mediaType: 'text/plain',
          d: db(),
        })
        backdateBlob(record.id, currentUnixSeconds() - 60)

        const result = await collectUnreferencedBlobs()

        expect(result.blobsCollected).toBe(0)
        expect(db().select().from(blobs).where(eq(blobs.id, record.id)).get()).toBeDefined()
      }
      finally {
        restoreEnv('CRADLE_BLOB_GC_GRACE_SECONDS', previousGrace)
      }
    })
  })

  it('does not collect a blob referenced by a chat_message_blob_refs row', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      const messageId = randomUUID()
      seedSession(sessionId)
      seedMessage({ sessionId, messageId })
      const record = await putBlob({ bytes: Buffer.from('referenced'), mediaType: 'text/plain', d: db() })
      backdateBlob(record.id, currentUnixSeconds() - 7200)
      insertRef({
        sessionId,
        messageId,
        blobId: record.id,
        partPath: '/parts/0/url',
        createdAt: currentUnixSeconds() - 7200,
      })

      const result = await collectUnreferencedBlobs()

      expect(result.blobsCollected).toBe(0)
      expect(db().select().from(blobs).where(eq(blobs.id, record.id)).get()).toBeDefined()
    })
  })

  it('keeps a blob referenced by two refs after deleting one of them', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      const messageA = randomUUID()
      const messageB = randomUUID()
      seedSession(sessionId)
      seedMessage({ sessionId, messageId: messageA })
      seedMessage({ sessionId, messageId: messageB })
      const record = await putBlob({ bytes: Buffer.from('shared-bytes'), mediaType: 'text/plain', d: db() })
      backdateBlob(record.id, currentUnixSeconds() - 7200)
      const refA = insertRef({
        sessionId,
        messageId: messageA,
        blobId: record.id,
        partPath: '/parts/0/url',
        createdAt: currentUnixSeconds() - 7200,
      })
      insertRef({
        sessionId,
        messageId: messageB,
        blobId: record.id,
        partPath: '/parts/0/url',
        createdAt: currentUnixSeconds() - 7200,
      })

      db().delete(chatMessageBlobRefs).where(eq(chatMessageBlobRefs.id, refA)).run()
      const result = await collectUnreferencedBlobs()

      expect(result.blobsCollected).toBe(0)
      expect(db().select().from(blobs).where(eq(blobs.id, record.id)).get()).toBeDefined()
      expect(db().select().from(chatMessageBlobRefs).where(eq(chatMessageBlobRefs.blobId, record.id)).all())
        .toHaveLength(1)
    })
  })

  it('collects a blob after session delete cascades its refs away', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      const messageId = randomUUID()
      seedSession(sessionId)
      seedMessage({ sessionId, messageId })
      const record = await putBlob({ bytes: Buffer.from('session-owned'), mediaType: 'text/plain', d: db() })
      const path = resolveBlobStorePath(record.storagePath)
      insertRef({
        sessionId,
        messageId,
        blobId: record.id,
        partPath: '/parts/0/url',
      })
      backdateBlob(record.id, currentUnixSeconds() - 7200)

      db().delete(sessions).where(eq(sessions.id, sessionId)).run()
      expect(db().select().from(chatMessageBlobRefs).all()).toHaveLength(0)

      const result = await collectUnreferencedBlobs()

      expect(result.blobsCollected).toBe(1)
      expect(db().select().from(blobs).where(eq(blobs.id, record.id)).get()).toBeUndefined()
      expect(existsSync(path)).toBe(false)
    })
  })

  it('phase A deletes an orphan ref older than the grace period and frees its blob', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      seedSession(sessionId)
      const record = await putBlob({ bytes: Buffer.from('orphan-ref-old'), mediaType: 'text/plain', d: db() })
      const path = resolveBlobStorePath(record.storagePath)
      const refId = insertRef({
        sessionId,
        messageId: randomUUID(),
        blobId: record.id,
        partPath: '/parts/0/output',
        kind: 'tool_output',
      })
      backdateRef(refId, currentUnixSeconds() - 7200)
      backdateBlob(record.id, currentUnixSeconds() - 7200)

      const result = await collectUnreferencedBlobs()

      expect(result.refsDropped).toBe(1)
      expect(result.blobsCollected).toBe(1)
      expect(db().select().from(chatMessageBlobRefs).where(eq(chatMessageBlobRefs.id, refId)).get())
        .toBeUndefined()
      expect(db().select().from(blobs).where(eq(blobs.id, record.id)).get()).toBeUndefined()
      expect(existsSync(path)).toBe(false)
    })
  })

  it('phase A does not delete an orphan ref within the grace period', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      seedSession(sessionId)
      const record = await putBlob({ bytes: Buffer.from('orphan-ref-fresh'), mediaType: 'text/plain', d: db() })
      const refId = insertRef({
        sessionId,
        messageId: randomUUID(),
        blobId: record.id,
        partPath: '/parts/0/input',
        kind: 'tool_input',
      })

      const result = await collectUnreferencedBlobs()

      expect(result.refsDropped).toBe(0)
      expect(result.blobsCollected).toBe(0)
      expect(db().select().from(chatMessageBlobRefs).where(eq(chatMessageBlobRefs.id, refId)).get())
        .toBeDefined()
      expect(db().select().from(blobs).where(eq(blobs.id, record.id)).get()).toBeDefined()
    })
  })

  it('collects at most 500 blobs per pass and reports the count', async () => {
    await withTempDataDir(async () => {
      const cutoff = currentUnixSeconds() - 7200
      for (let i = 0; i < 501; i += 1) {
        const record = await putBlob({
          bytes: Buffer.from(`batch-${i}`),
          mediaType: 'text/plain',
          d: db(),
        })
        backdateBlob(record.id, cutoff)
      }

      const result = await collectUnreferencedBlobs()

      expect(result.blobsCollected).toBe(500)
      expect(db().select().from(blobs).all()).toHaveLength(1)
    })
  })
})
