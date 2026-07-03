import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import {
  agents,
  backendRuns,
  backendSessionBindings,
  messages,
  providerTargets,
  sessionEvents,
  sessions,
  workspaces
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { ptyTimeline } from '../src/modules/pty/pty.timeline'
import { startOrAttach } from '../src/modules/pty/service'
import { indexMessage, searchThreads } from '../src/modules/search/service'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function localWorkspaceLocatorJson(path: string): string {
  return JSON.stringify({ hostId: 'local', path })
}

function readLocalWorkspacePath(locatorJson: string): string {
  const locator = JSON.parse(locatorJson) as { path?: unknown }
  if (typeof locator.path !== 'string') {
    throw new Error('Expected local workspace locator path')
  }
  return locator.path
}

async function waitForCondition(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`)
}

describe('session capability', () => {
  it('supports CRUD, patch updates, and export', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()

      const workspaceId = randomUUID()
      const providerTargetId = randomUUID()
      const secondaryProviderTargetId = randomUUID()
      d.insert(workspaces)
        .values({
          id: workspaceId,
          name: 'Workspace',
          locatorJson: localWorkspaceLocatorJson(workspaceRoot)
        })
        .run()
      d.insert(providerTargets)
        .values({
          id: providerTargetId,
          kind: 'manual',
          displayName: 'Test Provider Target',
          providerKind: 'openai-compatible'
        })
        .run()
      d.insert(providerTargets)
        .values({
          id: secondaryProviderTargetId,
          kind: 'manual',
          displayName: 'Secondary Provider Target',
          providerKind: 'openai-compatible'
        })
        .run()

      const sessionId = randomUUID()
      const createRes = await app.handle(
        new Request('http://localhost/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: sessionId,
            workspaceId,
            title: 'Chat',
            providerTargetId
          })
        })
      )
      expect(createRes.status).toBe(200)
      const created = await createRes.json()
      expect(created).toEqual(
        expect.objectContaining({
          id: sessionId,
          workspaceId,
          title: 'Chat',
          providerTargetId,
          agentId: null,
          modelId: null,
          status: 'idle',
          archivedAt: null
        })
      )
      expect(d.select().from(agents).all()).toHaveLength(0)
      expect(created.createdAt).toBeTypeOf('number')
      expect(created.updatedAt).toBeTypeOf('number')

      const listRes = await app.handle(
        new Request(`http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
      )
      const list = await listRes.json()
      expect(list).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: sessionId, modelId: null, status: 'idle' })
        ])
      )

      const allListRes = await app.handle(new Request('http://localhost/sessions'))
      expect(allListRes.status).toBe(200)
      expect(await allListRes.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: sessionId, modelId: null, status: 'idle' })
        ])
      )

      const getRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`))
      expect(await getRes.json()).toEqual(
        expect.objectContaining({ id: sessionId, modelId: null, status: 'idle' })
      )

      const missingGet = await app.handle(new Request('http://localhost/sessions/missing'))
      expect(missingGet.status).toBe(404)

      const updateRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Renamed Chat' })
        })
      )
      expect(updateRes.status).toBe(200)
      expect(await updateRes.json()).toEqual(expect.objectContaining({ title: 'Renamed Chat' }))
      const titleEvent = d
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.aggregateId, sessionId))
        .get()
      expect(titleEvent).toEqual(
        expect.objectContaining({
          eventType: 'TitleChanged',
          payload: expect.stringContaining('"title":"Renamed Chat"')
        })
      )

      const updated = await (
        await app.handle(new Request(`http://localhost/sessions/${sessionId}`))
      ).json()
      expect(updated.title).toBe('Renamed Chat')

      const pinRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pinned: true })
        })
      )
      expect(await pinRes.json()).toEqual(expect.objectContaining({ pinned: 1 }))

      const unpinRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pinned: false })
        })
      )
      expect(await unpinRes.json()).toEqual(expect.objectContaining({ pinned: 0 }))

      const missingPin = await app.handle(
        new Request('http://localhost/sessions/missing', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pinned: true })
        })
      )
      expect(missingPin.status).toBe(404)
      expect((await missingPin.json()).code).toBe('session_not_found')

      const archiveRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}/archive`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ archived: true })
        })
      )
      expect(archiveRes.status).toBe(200)
      const archived = await archiveRes.json()
      expect(archived).toEqual(
        expect.objectContaining({
          id: sessionId,
          archivedAt: expect.any(Number)
        })
      )

      const activeListAfterArchive = await (
        await app.handle(
          new Request(`http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
        )
      ).json()
      expect(activeListAfterArchive).toEqual([])

      const archivedList = await (
        await app.handle(
          new Request(
            `http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}&archived=true`
          )
        )
      ).json()
      expect(archivedList).toEqual([
        expect.objectContaining({ id: sessionId, archivedAt: expect.any(Number) })
      ])

      const restoreRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}/archive`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ archived: false })
        })
      )
      expect(restoreRes.status).toBe(200)
      expect(await restoreRes.json()).toEqual(
        expect.objectContaining({
          id: sessionId,
          archivedAt: null
        })
      )

      const missingArchive = await app.handle(
        new Request('http://localhost/sessions/missing/archive', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ archived: true })
        })
      )
      expect(missingArchive.status).toBe(404)
      expect((await missingArchive.json()).code).toBe('session_not_found')

      const userMessageId = randomUUID()
      const assistantMessageId = randomUUID()
      const now = Math.floor(Date.now() / 1000)
      d.insert(messages)
        .values([
          {
            id: userMessageId,
            sessionId,
            role: 'user',
            status: 'complete',
            content: 'Hello',
            messageJson: JSON.stringify({
              id: userMessageId,
              role: 'user',
              parts: [{ type: 'text', text: 'Hello' }]
            }),
            createdAt: now,
            updatedAt: now
          },
          {
            id: assistantMessageId,
            sessionId,
            role: 'assistant',
            status: 'complete',
            content: 'Hello world',
            messageJson: JSON.stringify({
              id: assistantMessageId,
              role: 'assistant',
              parts: [{ type: 'text', text: 'Hello world' }]
            }),
            createdAt: now + 1,
            updatedAt: now + 1
          }
        ])
        .run()

      const legacyMessagesRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}/messages`)
      )
      expect(legacyMessagesRes.status).toBe(404)

      const unreadGetRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`))
      expect(await unreadGetRes.json()).toEqual(
        expect.objectContaining({
          id: sessionId,
          latestAssistantMessageAt: now + 1,
          lastReadAt: null,
          unread: true
        })
      )

      const unreadListRes = await app.handle(
        new Request(`http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
      )
      expect(await unreadListRes.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: sessionId,
            latestAssistantMessageAt: now + 1,
            unread: true
          })
        ])
      )

      const readRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}/read`, { method: 'POST' })
      )
      expect(readRes.status).toBe(200)
      expect(await readRes.json()).toEqual(
        expect.objectContaining({
          id: sessionId,
          lastReadAt: now + 1,
          latestAssistantMessageAt: now + 1,
          unread: false
        })
      )

      const unreadRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}/unread`, { method: 'POST' })
      )
      expect(unreadRes.status).toBe(200)
      expect(await unreadRes.json()).toEqual(
        expect.objectContaining({
          id: sessionId,
          lastReadAt: now,
          latestAssistantMessageAt: now + 1,
          unread: true
        })
      )

      const missingReadRes = await app.handle(
        new Request('http://localhost/sessions/missing/read', { method: 'POST' })
      )
      expect(missingReadRes.status).toBe(404)

      const bindingId = randomUUID()
      d.insert(backendSessionBindings)
        .values({
          id: bindingId,
          chatSessionId: sessionId,
          providerTargetId,
          runtimeKind: 'standard',
          backendSessionId: 'provider-session-primary',
          requestedModelId: 'gpt-test'
        })
        .run()

      const getWithBindingRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`)
      )
      expect(await getWithBindingRes.json()).toEqual(
        expect.objectContaining({
          id: sessionId,
          modelId: 'gpt-test',
          status: 'idle'
        })
      )

      const providerModelPatchRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerTargetId: secondaryProviderTargetId,
            modelId: 'gpt-secondary'
          })
        })
      )
      expect(providerModelPatchRes.status).toBe(200)
      expect(await providerModelPatchRes.json()).toEqual(
        expect.objectContaining({
          providerTargetId: secondaryProviderTargetId,
          modelId: 'gpt-secondary'
        })
      )
      expect(
        d
          .select()
          .from(backendSessionBindings)
          .where(eq(backendSessionBindings.id, bindingId))
          .get()
      ).toBeUndefined()
      const patchedSessionRow = d.select().from(sessions).where(eq(sessions.id, sessionId)).get()
      expect(JSON.parse(patchedSessionRow?.configJson ?? '{}')).toEqual(
        expect.objectContaining({
          requestedModelId: 'gpt-secondary'
        })
      )

      const thinkingPatchRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            thinkingEffort: 'xhigh'
          })
        })
      )
      expect(thinkingPatchRes.status).toBe(200)
      expect(await thinkingPatchRes.json()).toEqual(
        expect.objectContaining({
          thinkingEffort: 'xhigh'
        })
      )
      const thinkingPatchedSessionRow = d
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .get()
      expect(JSON.parse(thinkingPatchedSessionRow?.configJson ?? '{}')).toEqual(
        expect.objectContaining({
          requestedModelId: 'gpt-secondary',
          requestedThinkingEffort: 'xhigh'
        })
      )

      const getWithPatchedProviderRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`)
      )
      expect(await getWithPatchedProviderRes.json()).toEqual(
        expect.objectContaining({
          providerTargetId: secondaryProviderTargetId,
          modelId: 'gpt-secondary',
          thinkingEffort: 'xhigh'
        })
      )

      const streamingRunId = randomUUID()
      d.insert(backendRuns)
        .values({
          id: streamingRunId,
          bindingId: null,
          chatSessionId: sessionId,
          messageId: assistantMessageId,
          origin: 'user',
          status: 'streaming',
          startedAt: now,
          finishedAt: null
        })
        .run()

      const streamingListRes = await app.handle(
        new Request(`http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
      )
      expect(await streamingListRes.json()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: sessionId, status: 'streaming' })])
      )

      const streamingGetRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`)
      )
      expect(await streamingGetRes.json()).toEqual(
        expect.objectContaining({ id: sessionId, status: 'streaming' })
      )

      d.update(backendRuns)
        .set({
          status: 'complete',
          finishedAt: now + 1
        })
        .where(eq(backendRuns.id, streamingRunId))
        .run()

      const completedGetRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`)
      )
      expect(await completedGetRes.json()).toEqual(
        expect.objectContaining({ id: sessionId, status: 'idle' })
      )

      const failedRunId = randomUUID()
      d.insert(backendRuns)
        .values({
          id: failedRunId,
          bindingId: null,
          chatSessionId: sessionId,
          messageId: assistantMessageId,
          origin: 'user',
          status: 'failed',
          errorText: 'Provider failed',
          startedAt: now + 2,
          finishedAt: now + 3
        })
        .run()

      const failedListRes = await app.handle(
        new Request(`http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
      )
      expect(await failedListRes.json()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: sessionId, status: 'error' })])
      )

      const failedGetRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`))
      expect(await failedGetRes.json()).toEqual(
        expect.objectContaining({ id: sessionId, status: 'error' })
      )

      d.insert(backendRuns)
        .values({
          id: randomUUID(),
          bindingId: null,
          chatSessionId: sessionId,
          messageId: assistantMessageId,
          origin: 'user',
          status: 'complete',
          startedAt: now + 4,
          finishedAt: now + 5
        })
        .run()

      const recoveredGetRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`)
      )
      expect(await recoveredGetRes.json()).toEqual(
        expect.objectContaining({ id: sessionId, status: 'idle' })
      )

      const activeGoalBindingId = randomUUID()
      d.insert(backendSessionBindings)
        .values({
          id: activeGoalBindingId,
          chatSessionId: sessionId,
          providerTargetId: secondaryProviderTargetId,
          runtimeKind: 'codex',
          backendSessionId: 'provider-session-secondary',
          backendStateSnapshot: JSON.stringify({
            models: { currentModelId: 'gpt-secondary' },
            codex: {
              goal: {
                threadId: 'codex-thread-active-goal',
                objective: 'Finish active goal',
                status: 'active'
              }
            }
          }),
          requestedModelId: 'gpt-secondary'
        })
        .run()

      const activeGoalGetRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`)
      )
      expect(await activeGoalGetRes.json()).toEqual(
        expect.objectContaining({ id: sessionId, status: 'idle' })
      )

      const activeGoalListRes = await app.handle(
        new Request(`http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
      )
      expect(await activeGoalListRes.json()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: sessionId, status: 'idle' })])
      )

      d.update(backendSessionBindings)
        .set({
          runtimeKind: 'standard',
          backendStateSnapshot: null
        })
        .where(eq(backendSessionBindings.id, activeGoalBindingId))
        .run()

      d.insert(backendRuns)
        .values({
          id: randomUUID(),
          bindingId: activeGoalBindingId,
          chatSessionId: sessionId,
          messageId: assistantMessageId,
          origin: 'user',
          status: 'streaming',
          startedAt: now + 3,
          finishedAt: null
        })
        .run()

      const staleStreamingGetRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`)
      )
      expect(await staleStreamingGetRes.json()).toEqual(
        expect.objectContaining({ id: sessionId, status: 'idle' })
      )

      const staleStreamingListRes = await app.handle(
        new Request(`http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
      )
      expect(await staleStreamingListRes.json()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: sessionId, status: 'idle' })])
      )

      const cliAgentId = randomUUID()
      d.insert(agents)
        .values({
          id: cliAgentId,
          name: 'CLI Agent',
          avatarStyle: 'bottts-neutral',
          avatarSeed: 'cli-seed',
          providerTargetId: null,
          runtimeKind: 'cli-tui',
          configJson: JSON.stringify({
            cliTui: {
              preset: 'claude-code',
              executable: 'claude',
              args: ['--print']
            }
          })
        })
        .run()

      const cliSessionRes = await app.handle(
        new Request('http://localhost/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            title: 'CLI Session',
            agentId: cliAgentId
          })
        })
      )
      expect(cliSessionRes.status).toBe(200)
      expect(await cliSessionRes.json()).toEqual(
        expect.objectContaining({
          agentId: cliAgentId,
          providerTargetId: null,
          runtimeKind: 'cli-tui',
          status: 'idle'
        })
      )

      const exportRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}/export/markdown`)
      )
      const exportBody = await exportRes.json()
      expect(exportBody.markdown).toContain('# Renamed Chat')
      expect(exportBody.markdown).toContain('Model: gpt-secondary')
      expect(exportBody.markdown).toContain('## User')
      expect(exportBody.markdown).toContain('Hello')
      expect(exportBody.markdown).toContain('## Assistant')
      expect(exportBody.markdown).toContain('Hello world')

      const invalidCreate = await app.handle(
        new Request('http://localhost/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: '' })
        })
      )
      expect(invalidCreate.status).toBe(400)
      const invalidBody = await invalidCreate.json()
      expect(invalidBody.code).toBe('validation_error')

      const deleteRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`, { method: 'DELETE' })
      )
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })

      const afterList = await (
        await app.handle(
          new Request(`http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
        )
      ).json()
      expect(afterList).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          runtimeKind: 'cli-tui',
          agentId: cliAgentId
        })
      ])
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('creates provider-backed agent sessions with agent runtime defaults', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()

      const workspaceId = randomUUID()
      const providerTargetId = randomUUID()
      const agentId = randomUUID()
      d.insert(workspaces)
        .values({
          id: workspaceId,
          name: 'Workspace',
          locatorJson: localWorkspaceLocatorJson(workspaceRoot)
        })
        .run()
      d.insert(providerTargets)
        .values({
          id: providerTargetId,
          kind: 'manual',
          displayName: 'Codex Provider Target',
          providerKind: 'openai-compatible'
        })
        .run()
      d.insert(agents)
        .values({
          id: agentId,
          name: 'Codex Agent',
          avatarStyle: 'bottts-neutral',
          avatarSeed: 'codex-agent-seed',
          providerTargetId,
          modelId: 'gpt-5.5',
          thinkingEffort: 'medium',
          runtimeKind: 'codex'
        })
        .run()

      const sessionId = randomUUID()
      const createRes = await app.handle(
        new Request('http://localhost/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: sessionId,
            workspaceId,
            title: 'Agent Session',
            agentId
          })
        })
      )
      expect(createRes.status).toBe(200)
      expect(await createRes.json()).toEqual(
        expect.objectContaining({
          id: sessionId,
          agentId,
          providerTargetId,
          runtimeKind: 'codex',
          modelId: 'gpt-5.5'
        })
      )

      const sessionRow = d.select().from(sessions).where(eq(sessions.id, sessionId)).get()
      expect(JSON.parse(sessionRow?.configJson ?? '{}')).toEqual(
        expect.objectContaining({
          requestedModelId: 'gpt-5.5',
          requestedThinkingEffort: 'medium'
        })
      )
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('persists and filters coarse session origins', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()

      const workspaceId = randomUUID()
      const providerTargetId = randomUUID()
      d.insert(workspaces)
        .values({
          id: workspaceId,
          name: 'Origin Workspace',
          locatorJson: localWorkspaceLocatorJson(workspaceRoot)
        })
        .run()
      d.insert(providerTargets)
        .values({
          id: providerTargetId,
          kind: 'manual',
          displayName: 'Origin Provider Target',
          providerKind: 'openai-compatible'
        })
        .run()

      const manualSessionId = randomUUID()
      const manualCreateRes = await app.handle(
        new Request('http://localhost/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: manualSessionId,
            workspaceId,
            title: 'Manual Origin Session',
            providerTargetId
          })
        })
      )
      expect(manualCreateRes.status).toBe(200)
      expect(await manualCreateRes.json()).toEqual(
        expect.objectContaining({
          id: manualSessionId,
          origin: 'manual'
        })
      )

      const automationSessionId = randomUUID()
      const automationCreateRes = await app.handle(
        new Request('http://localhost/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: automationSessionId,
            workspaceId,
            title: 'Automation Origin Session',
            origin: 'automation',
            providerTargetId
          })
        })
      )
      expect(automationCreateRes.status).toBe(200)
      expect(await automationCreateRes.json()).toEqual(
        expect.objectContaining({
          id: automationSessionId,
          origin: 'automation'
        })
      )

      const automationListRes = await app.handle(
        new Request(
          `http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}&origin=automation`
        )
      )
      expect(automationListRes.status).toBe(200)
      expect(await automationListRes.json()).toEqual([
        expect.objectContaining({
          id: automationSessionId,
          origin: 'automation'
        })
      ])

      const manualListRes = await app.handle(
        new Request(
          `http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}&origin=manual`
        )
      )
      expect(manualListRes.status).toBe(200)
      expect(await manualListRes.json()).toEqual([
        expect.objectContaining({
          id: manualSessionId,
          origin: 'manual'
        })
      ])

      const getAutomationRes = await app.handle(
        new Request(`http://localhost/sessions/${automationSessionId}`)
      )
      expect(getAutomationRes.status).toBe(200)
      expect(await getAutomationRes.json()).toEqual(
        expect.objectContaining({
          id: automationSessionId,
          origin: 'automation'
        })
      )
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('repairs persisted streaming runs during app startup', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      const d = db()
      const now = Math.floor(Date.now() / 1000)
      const workspaceId = randomUUID()
      const providerTargetId = randomUUID()
      const sessionId = randomUUID()
      const bindingId = randomUUID()
      const assistantMessageId = randomUUID()
      const runId = randomUUID()

      d.insert(workspaces)
        .values({
          id: workspaceId,
          name: 'Workspace',
          locatorJson: localWorkspaceLocatorJson(workspaceRoot)
        })
        .run()
      d.insert(providerTargets)
        .values({
          id: providerTargetId,
          kind: 'manual',
          displayName: 'Provider Target',
          providerKind: 'openai-compatible'
        })
        .run()
      d.insert(sessions)
        .values({
          id: sessionId,
          workspaceId,
          title: 'Stale Streaming Session',
          providerTargetId,
          runtimeKind: 'standard',
          agentId: null,
          configJson: '{}',
          linkedIssueId: null,
          pinned: 0,
          createdAt: now,
          updatedAt: now
        })
        .run()
      d.insert(messages)
        .values({
          id: assistantMessageId,
          sessionId,
          role: 'assistant',
          status: 'streaming',
          content: 'partial response',
          messageJson: JSON.stringify({
            id: assistantMessageId,
            role: 'assistant',
            parts: [{ type: 'text', text: 'partial response' }]
          }),
          createdAt: now,
          updatedAt: now
        })
        .run()
      d.insert(backendSessionBindings)
        .values({
          id: bindingId,
          chatSessionId: sessionId,
          providerTargetId,
          runtimeKind: 'standard',
          backendSessionId: 'provider-session-stale-streaming',
          requestedModelId: 'gpt-test'
        })
        .run()
      d.insert(backendRuns)
        .values({
          id: runId,
          bindingId,
          chatSessionId: sessionId,
          messageId: assistantMessageId,
          origin: 'user',
          status: 'streaming',
          startedAt: now,
          finishedAt: null
        })
        .run()

      app = await createServerApp({ recoverPersistedRunsOnCreate: true })

      const getRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`))
      expect(await getRes.json()).toEqual(
        expect.objectContaining({
          id: sessionId,
          modelId: 'gpt-test',
          status: 'error'
        })
      )
      expect(d.select().from(backendRuns).where(eq(backendRuns.id, runId)).get()).toEqual(
        expect.objectContaining({
          status: 'failed',
          stopReason: 'response.interrupted',
          errorText:
            'Response interrupted because the Cradle server process exited while the run was streaming.',
          finishedAt: expect.any(Number)
        })
      )
      expect(d.select().from(messages).where(eq(messages.id, assistantMessageId)).get()).toEqual(
        expect.objectContaining({
          status: 'failed',
          errorText:
            'Response interrupted because the Cradle server process exited while the run was streaming.'
        })
      )
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('ignores legacy non-resumable provider bindings in session projections', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()

      const workspaceId = randomUUID()
      const providerTargetId = randomUUID()
      const sessionId = randomUUID()
      const now = Math.floor(Date.now() / 1000)

      d.insert(workspaces)
        .values({
          id: workspaceId,
          name: 'Workspace',
          locatorJson: localWorkspaceLocatorJson(workspaceRoot)
        })
        .run()
      d.insert(providerTargets)
        .values({
          id: providerTargetId,
          kind: 'manual',
          displayName: 'Provider Target',
          providerKind: 'openai-compatible'
        })
        .run()
      d.insert(sessions)
        .values({
          id: sessionId,
          workspaceId,
          title: 'Legacy Binding Session',
          providerTargetId,
          runtimeKind: 'codex',
          agentId: null,
          configJson: '{}',
          linkedIssueId: null,
          pinned: 0,
          createdAt: now,
          updatedAt: now
        })
        .run()
      d.insert(backendSessionBindings)
        .values({
          id: randomUUID(),
          chatSessionId: sessionId,
          providerTargetId,
          runtimeKind: 'codex',
          requestedModelId: 'legacy-model',
          backendStateSnapshot: JSON.stringify({
            codex: {
              goal: {
                threadId: 'legacy-thread',
                objective: 'Do not project this goal',
                status: 'active'
              }
            }
          })
        })
        .run()

      const getRes = await app.handle(new Request(`http://localhost/sessions/${sessionId}`))
      expect(await getRes.json()).toEqual(
        expect.objectContaining({
          id: sessionId,
          modelId: null,
          status: 'idle'
        })
      )

      const listRes = await app.handle(
        new Request(`http://localhost/sessions?workspaceId=${encodeURIComponent(workspaceId)}`)
      )
      expect(await listRes.json()).toEqual([
        expect.objectContaining({
          id: sessionId,
          modelId: null,
          status: 'idle'
        })
      ])

      const exportRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}/export/markdown`)
      )
      const exportBody = await exportRes.json()
      expect(exportBody.markdown).toContain('Model: unknown')
      expect(exportBody.markdown).not.toContain('legacy-model')
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('creates a dated ad-hoc workspace when session creation has no workspace', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const adHocRoot = makeTempDir('cradle-ad-hoc-workspaces-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousAdHocRoot = process.env.CRADLE_AD_HOC_WORKSPACE_ROOT
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_AD_HOC_WORKSPACE_ROOT = adHocRoot
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()
      const providerTargetId = randomUUID()
      d.insert(providerTargets)
        .values({
          id: providerTargetId,
          kind: 'manual',
          displayName: 'Ad Hoc Provider Target',
          providerKind: 'openai-compatible'
        })
        .run()

      const createRes = await app.handle(
        new Request('http://localhost/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'No Project Chat',
            providerTargetId
          })
        })
      )

      expect(createRes.status).toBe(200)
      const created = await createRes.json()
      expect(created.workspaceId).toEqual(expect.any(String))

      const workspace = d
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, created.workspaceId))
        .get()
      expect(workspace).toEqual(
        expect.objectContaining({
          id: created.workspaceId,
          name: expect.stringMatching(/^Chat \d{4}-\d{2}-\d{2}$/)
        })
      )
      const workspacePath = readLocalWorkspacePath(workspace!.locatorJson)
      const workspaceRelativePath = relative(adHocRoot, workspacePath).replaceAll('\\', '/')
      expect(workspaceRelativePath).toMatch(/^\d{4}-\d{2}-\d{2}\/\d{8}-\d{6}-[0-9a-f-]{36}$/)
      expect(existsSync(workspacePath)).toBe(true)
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(adHocRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousAdHocRoot === undefined) {
        delete process.env.CRADLE_AD_HOC_WORKSPACE_ROOT
      } else {
        process.env.CRADLE_AD_HOC_WORKSPACE_ROOT = previousAdHocRoot
      }
    }
  })

  it('keeps explicitly unbound Jarvis sessions out of workspace records', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const adHocRoot = makeTempDir('cradle-ad-hoc-workspaces-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousAdHocRoot = process.env.CRADLE_AD_HOC_WORKSPACE_ROOT
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_AD_HOC_WORKSPACE_ROOT = adHocRoot
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()
      const providerTargetId = randomUUID()
      d.insert(providerTargets)
        .values({
          id: providerTargetId,
          kind: 'manual',
          displayName: 'Jarvis Provider Target',
          providerKind: 'openai-compatible'
        })
        .run()

      const createRes = await app.handle(
        new Request('http://localhost/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId: null,
            title: 'Jarvis',
            providerTargetId,
            runtimeKind: 'jar-core'
          })
        })
      )

      expect(createRes.status).toBe(200)
      const created = await createRes.json()
      expect(created).toEqual(
        expect.objectContaining({
          workspaceId: null,
          runtimeKind: 'jar-core'
        })
      )
      expect(d.select().from(workspaces).all()).toEqual([])
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(adHocRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousAdHocRoot === undefined) {
        delete process.env.CRADLE_AD_HOC_WORKSPACE_ROOT
      } else {
        process.env.CRADLE_AD_HOC_WORKSPACE_ROOT = previousAdHocRoot
      }
    }
  })

  it('deletes session-owned search and cli-tui pty state', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()

      const workspaceId = randomUUID()
      d.insert(workspaces)
        .values({
          id: workspaceId,
          name: 'Workspace',
          locatorJson: localWorkspaceLocatorJson(workspaceRoot)
        })
        .run()

      const agentId = randomUUID()
      d.insert(agents)
        .values({
          id: agentId,
          name: 'CLI Agent',
          avatarStyle: 'bottts-neutral',
          avatarSeed: 'cleanup-seed',
          providerTargetId: null,
          runtimeKind: 'cli-tui',
          configJson: JSON.stringify({
            cliTui: {
              executable: process.execPath,
              args: ['-e', 'setInterval(() => {}, 1000)']
            }
          })
        })
        .run()

      const sessionId = randomUUID()
      const createRes = await app.handle(
        new Request('http://localhost/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: sessionId,
            workspaceId,
            title: 'CLI Cleanup Session',
            agentId
          })
        })
      )
      expect(createRes.status).toBe(200)

      startOrAttach({ sessionId, cols: 80, rows: 24 })
      expect(ptyTimeline.hasSession(sessionId)).toBe(true)

      const messageId = randomUUID()
      const now = Math.floor(Date.now() / 1000)
      d.insert(messages)
        .values({
          id: messageId,
          sessionId,
          role: 'assistant',
          status: 'complete',
          content: 'cleanup sentinel text',
          messageJson: JSON.stringify({
            id: messageId,
            role: 'assistant',
            parts: [{ type: 'text', text: 'cleanup sentinel text' }]
          }),
          createdAt: now,
          updatedAt: now
        })
        .run()
      indexMessage(sessionId, 'CLI Cleanup Session', messageId, 'cleanup sentinel text')
      expect(searchThreads({ query: 'cleanup sentinel' })).toEqual([
        expect.objectContaining({ sessionId })
      ])

      const deleteRes = await app.handle(
        new Request(`http://localhost/sessions/${sessionId}`, { method: 'DELETE' })
      )
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })

      await waitForCondition(() => !ptyTimeline.hasSession(sessionId))
      expect(searchThreads({ query: 'cleanup sentinel' })).toEqual([])
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
