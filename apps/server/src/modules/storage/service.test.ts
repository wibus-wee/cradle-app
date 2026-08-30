import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  chatMessageBlobRefs,
  chatMessagePayloads,
  messages,
  sessions,
} from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { currentUnixSeconds } from '../../helpers/time'
import { db, shutdownInfra } from '../../infra'
import { putBlob } from '../blob-store/service'
import { getStorageOverview } from './service'

const previousDataDir = process.env.CRADLE_DATA_DIR
const previousDbPath = process.env.CRADLE_DB_PATH
let dataDir: string

describe('storage service', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-storage-overview-'))
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_DB_PATH
    shutdownInfra()
  })

  afterEach(() => {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CRADLE_DB_PATH', previousDbPath)
  })

  it('counts only uniquely owned attachment bytes as reclaimable', () => {
    const firstSessionId = randomUUID()
    const secondSessionId = randomUUID()
    seedSession(firstSessionId, 'First')
    seedSession(secondSessionId, 'Second')

    const firstMessageId = seedMessage(firstSessionId)
    const duplicateMessageId = seedMessage(firstSessionId)
    const secondMessageId = seedMessage(secondSessionId)
    const sharedMessageId = seedMessage(firstSessionId)
    const uniqueBlob = putBlob({ bytes: Buffer.from('unique attachment'), mediaType: 'text/plain', d: db() })
    const sharedBlob = putBlob({ bytes: Buffer.from('shared attachment'), mediaType: 'text/plain', d: db() })

    seedBlobRef({ sessionId: firstSessionId, messageId: firstMessageId, blobId: uniqueBlob.id, partPath: '/parts/0' })
    seedBlobRef({ sessionId: firstSessionId, messageId: duplicateMessageId, blobId: uniqueBlob.id, partPath: '/parts/0' })
    seedBlobRef({ sessionId: firstSessionId, messageId: sharedMessageId, blobId: sharedBlob.id, partPath: '/parts/0' })
    seedBlobRef({ sessionId: secondSessionId, messageId: secondMessageId, blobId: sharedBlob.id, partPath: '/parts/0' })

    const overview = getStorageOverview()
    const first = overview.sessions.find(session => session.id === firstSessionId)
    const second = overview.sessions.find(session => session.id === secondSessionId)

    expect(first?.attachmentBytes).toBe(uniqueBlob.byteSize)
    expect(second?.attachmentBytes).toBe(0)
    expect(overview.categories.reduce((sum, category) => sum + category.bytes, 0)).toBe(overview.totalBytes)
  })
})

function seedSession(id: string, title: string): void {
  const now = currentUnixSeconds()
  db().insert(sessions).values({
    id,
    title,
    titleSource: 'initial',
    runtimeKind: 'standard',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedMessage(sessionId: string): string {
  const id = randomUUID()
  const now = currentUnixSeconds()
  db().insert(chatMessagePayloads).values({
    id,
    sessionId,
    content: 'message',
    messageJson: JSON.stringify({ id, role: 'user', parts: [] }),
    createdAt: now,
    updatedAt: now,
  }).run()
  db().insert(messages).values({
    id,
    sessionId,
    role: 'user',
    status: 'complete',
    payloadId: id,
    createdAt: now,
    updatedAt: now,
  }).run()
  return id
}

function seedBlobRef(input: {
  sessionId: string
  messageId: string
  blobId: string
  partPath: string
}): void {
  db().insert(chatMessageBlobRefs).values({
    id: randomUUID(),
    sessionId: input.sessionId,
    messageId: input.messageId,
    blobId: input.blobId,
    partPath: input.partPath,
    kind: 'file',
    createdAt: currentUnixSeconds(),
  }).run()
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
