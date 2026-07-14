import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { messages, providerTargets, sessions, threadHandoffs } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import * as ThreadHandoff from './service'

const importedMessagesMock = vi.hoisted(() => vi.fn())
const providerTargetsMock = vi.hoisted(() => ({
  getProviderTarget: vi.fn(),
  assertProviderTargetCompatibleWithRuntime: vi.fn(),
}))
const sessionMock = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../chat-runtime/es/commands', () => ({
  recordImportedSessionMessages: importedMessagesMock,
}))
vi.mock('../provider-targets/service', () => providerTargetsMock)
vi.mock('../session/service', () => sessionMock)

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir: string

const sourceSession = {
  id: 'source-session',
  workspaceId: null,
  title: 'Source session',
  providerTargetId: 'source-target',
  runtimeKind: 'standard',
  linkedIssueId: null,
  sessionGroupId: null,
  worktreeId: null,
}

const destinationSession = {
  ...sourceSession,
  id: 'destination-session',
  providerTargetId: 'destination-target',
}

function seedSession(id: string): void {
  const now = Math.floor(Date.now() / 1000)
  db().insert(sessions).values({ id, title: id, createdAt: now, updatedAt: now }).run()
}

function seedProviderTarget(id: string): void {
  const now = Math.floor(Date.now() / 1000)
  db().insert(providerTargets).values({
    id,
    kind: 'manual',
    providerKind: 'openai-compatible',
    displayName: id,
    enabled: true,
    connectionConfigJson: '{}',
    enabledModelsJson: '[]',
    customModelsJson: '[]',
    createdAt: now,
    updatedAt: now,
  }).run()
}

describe('thread handoff service', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-thread-handoff-'))
    process.env.CRADLE_DATA_DIR = dataDir
    vi.clearAllMocks()
  })

  afterEach(() => {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
  })

  it('removes the destination session when transcript import fails', async () => {
    const now = Math.floor(Date.now() / 1000)
    seedSession('source-session')
    db().insert(messages).values({
      id: 'source-message',
      sessionId: 'source-session',
      role: 'user',
      status: 'complete',
      content: 'Continue this work',
      messageJson: JSON.stringify({ id: 'source-message', role: 'user', parts: [] }),
      createdAt: now,
      updatedAt: now,
    }).run()
    sessionMock.get.mockReturnValue(sourceSession)
    sessionMock.create.mockResolvedValue(destinationSession)
    sessionMock.remove.mockResolvedValue({ ok: true })
    providerTargetsMock.getProviderTarget.mockReturnValue({ id: 'destination-target', enabled: true })
    importedMessagesMock.mockRejectedValue(new Error('import failed'))

    await expect(ThreadHandoff.create({
      requestId: 'request-1',
      sourceSessionId: 'source-session',
      destinationProviderTargetId: 'destination-target',
    })).rejects.toThrow('import failed')

    expect(sessionMock.remove).toHaveBeenCalledOnce()
    expect(sessionMock.remove).toHaveBeenCalledWith(expect.any(String))
  })

  it('returns the existing destination for a repeated request id', async () => {
    const now = Math.floor(Date.now() / 1000)
    seedProviderTarget('destination-target')
    seedSession('source-session')
    seedSession('destination-session')
    db().insert(threadHandoffs).values({
      id: 'handoff-1',
      requestId: 'request-1',
      sourceSessionId: 'source-session',
      destinationSessionId: 'destination-session',
      sourceProviderTargetId: null,
      destinationProviderTargetId: 'destination-target',
      importedMessageCount: 2,
      createdAt: now,
    }).run()
    sessionMock.get.mockImplementation((id: string) => id === 'destination-session' ? destinationSession : null)

    const result = await ThreadHandoff.create({
      requestId: 'request-1',
      sourceSessionId: 'source-session',
      destinationProviderTargetId: 'destination-target',
    })

    expect(result.handoff.id).toBe('handoff-1')
    expect(result.session).toBe(destinationSession)
    expect(sessionMock.create).not.toHaveBeenCalled()
    expect(importedMessagesMock).not.toHaveBeenCalled()
  })
})
