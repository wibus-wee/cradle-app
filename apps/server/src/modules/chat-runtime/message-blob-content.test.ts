import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chatMessageBlobRefs, sessions } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { currentUnixSeconds } from '../../helpers/time'
import { db, shutdownInfra } from '../../infra'
import { putBlob } from '../blob-store/service'
import { readSessionMessageBlob } from './message-blob-content'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-blob-content-'))
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
    title: 'Blob content test',
    titleSource: 'initial',
    runtimeKind: 'standard',
    createdAt: now,
    updatedAt: now,
  }).run()
}

describe('readSessionMessageBlob', () => {
  it('serves a blob only through a session that references it', async () => {
    await withTempDataDir(async () => {
      const sessionId = randomUUID()
      const otherSessionId = randomUUID()
      seedSession(sessionId)
      seedSession(otherSessionId)

      const bytes = Buffer.from('session-owned-blob')
      const blob = putBlob({ bytes, mediaType: 'text/plain', d: db() })
      db().insert(chatMessageBlobRefs).values({
        id: randomUUID(),
        sessionId,
        messageId: randomUUID(),
        partPath: '/parts/0/url',
        kind: 'file',
        blobId: blob.id,
        createdAt: currentUnixSeconds(),
      }).run()

      await expect(readSessionMessageBlob(sessionId, blob.id)).resolves.toMatchObject({
        bytes,
        mediaType: 'text/plain',
        byteSize: bytes.length,
      })
      await expect(readSessionMessageBlob(otherSessionId, blob.id)).rejects.toMatchObject({
        code: 'chat_message_blob_not_found',
        status: 404,
      })
    })
  })
})
