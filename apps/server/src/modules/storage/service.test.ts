import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  backendSessionBindings,
  chatMessageBlobRefs,
  chatMessagePayloads,
  messages,
  providerTargets,
  sessions,
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { currentUnixSeconds } from '../../helpers/time'
import { db, shutdownInfra } from '../../infra'
import { putBlob } from '../blob-store/service'
import { resolveKimiProviderHome } from '../chat-runtime-providers/kimi/runtime-home'
import { measureStorageOverview } from './service'

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

    const overview = measureStorageOverview()
    const first = overview.sessions.find(session => session.id === firstSessionId)
    const second = overview.sessions.find(session => session.id === secondSessionId)

    expect(first?.attachmentBytes).toBe(uniqueBlob.byteSize)
    expect(second?.attachmentBytes).toBe(0)
    expect(overview.categories.reduce((sum, category) => sum + category.bytes, 0)).toBe(overview.totalBytes)
  })

  it('attributes Kimi native session bytes to the bound Cradle session', () => {
    db().insert(providerTargets).values({
      id: 'kimi-target',
      kind: 'manual',
      providerKind: 'openai-compatible',
      displayName: 'Kimi',
    }).run()
    const sessionId = randomUUID()
    seedSession(sessionId, 'Kimi storage')
    db().update(sessions).set({ providerTargetId: 'kimi-target', runtimeKind: 'kimi' }).where(eq(sessions.id, sessionId)).run()
    db().insert(backendSessionBindings).values({
      id: randomUUID(),
      chatSessionId: sessionId,
      providerTargetId: 'kimi-target',
      runtimeKind: 'kimi',
      backendSessionId: 'session_native',
    }).run()
    const home = resolveKimiProviderHome('kimi-target')
    mkdirSync(join(home, 'sessions', 'workspace', 'session_native'), { recursive: true })
    mkdirSync(join(home, 'server', 'events'), { recursive: true })
    writeFileSync(join(home, 'sessions', 'workspace', 'session_native', 'state.json'), 'native state')
    writeFileSync(join(home, 'server', 'events', 'session_native.jsonl'), 'native event')

    const stored = measureStorageOverview().sessions.find(session => session.id === sessionId)

    expect(stored?.runtimeBytes).toBe(Buffer.byteLength('native state') + Buffer.byteLength('native event'))
    expect(stored?.reclaimableBytes).toBe((stored?.localBytes ?? 0) + (stored?.runtimeBytes ?? 0))
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
