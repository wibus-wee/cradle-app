import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseBlobUrl } from '@cradle/chat-runtime-contracts'
import {
  chatMessageBlobRefs,
  messages,
  providerTargets,
  sessions,
  threadHandoffs,
} from '@cradle/db'
import type { UIMessage } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import { toDurableMessagePayload } from '../chat-runtime/message-durable-payload'
import {
  putMessagePayload,
  toMessageProjectionValues,
} from '../chat-runtime/message-payload-store'
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
const preferencesMock = vi.hoisted(() => ({
  assertAppFeatureFlagEnabled: vi.fn(),
}))

vi.mock('../chat-runtime/es/commands', () => ({
  recordImportedSessionMessages: importedMessagesMock,
}))
vi.mock('../provider-targets/service', () => providerTargetsMock)
vi.mock('../preferences/service', () => preferencesMock)
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

  it('rejects handoffs while the feature flag is disabled', async () => {
    preferencesMock.assertAppFeatureFlagEnabled.mockImplementationOnce(() => {
      throw new Error('Thread handoffs are disabled')
    })

    await expect(ThreadHandoff.create({
      requestId: 'request-disabled',
      sourceSessionId: 'source-session',
      destinationRuntimeKind: 'codex',
      destinationProviderTargetId: 'destination-target',
    })).rejects.toThrow('Thread handoffs are disabled')

    expect(sessionMock.get).not.toHaveBeenCalled()
  })

  it('removes the destination session when transcript import fails', async () => {
    const now = Math.floor(Date.now() / 1000)
    seedSession('source-session')
    const message = {
      id: 'source-message',
      sessionId: 'source-session',
      parentMessageId: null,
      parentToolCallId: null,
      taskId: null,
      depth: 0,
      role: 'user',
      status: 'complete',
      content: 'Continue this work',
      messageJson: JSON.stringify({ id: 'source-message', role: 'user', parts: [] }),
      errorText: null,
      createdAt: now,
      updatedAt: now,
    } as const
    putMessagePayload(db(), message)
    db().insert(messages).values(toMessageProjectionValues(message)).run()
    sessionMock.get.mockReturnValue(sourceSession)
    sessionMock.create.mockImplementation(async (input: { id: string }) => {
      seedSession(input.id)
      return { ...destinationSession, id: input.id }
    })
    sessionMock.remove.mockResolvedValue({ ok: true })
    providerTargetsMock.getProviderTarget.mockReturnValue({ id: 'destination-target', enabled: true })
    importedMessagesMock.mockRejectedValue(new Error('import failed'))

    await expect(ThreadHandoff.create({
      requestId: 'request-1',
      sourceSessionId: 'source-session',
      destinationRuntimeKind: 'codex',
      destinationProviderTargetId: 'destination-target',
    })).rejects.toThrow('import failed')

    expect(providerTargetsMock.assertProviderTargetCompatibleWithRuntime).toHaveBeenCalledWith(
      'destination-target',
      'codex',
    )
    expect(sessionMock.create).toHaveBeenCalledWith(expect.objectContaining({
      providerTargetId: 'destination-target',
      runtimeKind: 'codex',
    }))
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
      destinationRuntimeKind: 'codex',
      destinationProviderTargetId: 'destination-target',
    })

    expect(result.handoff.id).toBe('handoff-1')
    expect(result.session).toBe(destinationSession)
    expect(sessionMock.create).not.toHaveBeenCalled()
    expect(importedMessagesMock).not.toHaveBeenCalled()
  })

  it('rebinds source blob references to the destination session', async () => {
    const now = Math.floor(Date.now() / 1000)
    seedProviderTarget('source-target')
    seedProviderTarget('destination-target')
    seedSession('source-session')
    const sourceMessage = {
      id: 'source-message',
      role: 'user',
      parts: [{
        type: 'file',
        mediaType: 'image/png',
        url: `data:image/png;base64,${Buffer.alloc(8_192, 0x41).toString('base64')}`,
      }],
    } as UIMessage
    const sourceDurable = toDurableMessagePayload({
      sessionId: 'source-session',
      message: sourceMessage,
    })
    const sourceFact = {
      id: sourceMessage.id,
      sessionId: 'source-session',
      parentMessageId: null,
      parentToolCallId: null,
      taskId: null,
      depth: 0,
      role: 'user',
      status: 'complete',
      content: sourceDurable.content,
      messageJson: sourceDurable.messageJson,
      errorText: null,
      createdAt: now,
      updatedAt: now,
    } as const
    putMessagePayload(db(), sourceFact)
    db().insert(messages).values(toMessageProjectionValues(sourceFact)).run()
    sessionMock.get.mockReturnValue(sourceSession)
    sessionMock.create.mockImplementation(async (input: { id: string }) => {
      seedSession(input.id)
      return { ...destinationSession, id: input.id }
    })
    sessionMock.remove.mockResolvedValue({ ok: true })
    providerTargetsMock.getProviderTarget.mockReturnValue({
      id: 'destination-target',
      enabled: true,
    })
    importedMessagesMock.mockResolvedValue(undefined)

    const result = await ThreadHandoff.create({
      requestId: 'request-with-blob',
      sourceSessionId: 'source-session',
      destinationRuntimeKind: 'codex',
      destinationProviderTargetId: 'destination-target',
    })

    const imported = importedMessagesMock.mock.calls[0]?.[0].messages as Array<{
      messageJson: string
    }>
    const importedMessage = JSON.parse(imported[0]!.messageJson) as UIMessage
    const importedPart = importedMessage.parts[0]
    expect(importedPart?.type).toBe('file')
    expect(parseBlobUrl(importedPart?.type === 'file' ? importedPart.url : '')).toBeTruthy()
    expect(db().select().from(chatMessageBlobRefs).all().map(ref => ref.sessionId).sort())
      .toEqual(['source-session', result.session.id].sort())
  })

  it('rejects handing off to the current runtime and provider target combination', async () => {
    sessionMock.get.mockReturnValue(sourceSession)
    providerTargetsMock.getProviderTarget.mockReturnValue({ id: 'source-target', enabled: true })

    await expect(ThreadHandoff.create({
      requestId: 'request-same-target',
      sourceSessionId: 'source-session',
      destinationRuntimeKind: 'standard',
      destinationProviderTargetId: 'source-target',
    })).rejects.toThrow('Choose a different runtime or provider target for handoff')

    expect(sessionMock.create).not.toHaveBeenCalled()
  })
})
