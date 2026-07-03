// Tests for session-await trigger dispatch
// Verifies that await completion is delivered through Chat Runtime's durable queue.

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  agents,
  agentSessions,
  providerTargets,
  sessionAwaits,
  sessions,
  workspaces
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '../src/errors/app-error'
import { db, shutdownInfra } from '../src/infra'
import { enqueueSessionQueueItem } from '../src/modules/chat-runtime/runtime'
import * as Issue from '../src/modules/issue/service'
import {
  registerSource,
  requestRun,
  runOnce,
  unregisterSource
} from '../src/modules/session-await/poller'
import {
  fetchAvailableChecks,
  getSessionSummary,
  listBySession,
  register,
  retryDelivery,
  trigger
} from '../src/modules/session-await/service'
import {
  CRADLE_ISSUE_AGENT_AWAIT_SOURCE,
  cradleIssueAgentSource
} from '../src/modules/session-await/sources/cradle-issue-agent'
import {
  CRADLE_ISSUE_STATUS_AWAIT_SOURCE,
  cradleIssueStatusSource
} from '../src/modules/session-await/sources/cradle-issue-status'
import { resetTokenCache } from '../src/modules/session-await/sources/github-ci'

vi.mock('../src/modules/chat-runtime/runtime', () => ({
  enqueueSessionQueueItem: vi.fn()
}))

const mockedEnqueueSessionQueueItem = vi.mocked(enqueueSessionQueueItem)
const originalFetch = globalThis.fetch

describe('session-await trigger', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-await-test-'))
    process.env.CRADLE_DATA_DIR = dataDir
    mockedEnqueueSessionQueueItem.mockReset()
    registerSource(cradleIssueAgentSource)
    registerSource(cradleIssueStatusSource)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    unregisterSource('test-source')
    unregisterSource(CRADLE_ISSUE_AGENT_AWAIT_SOURCE)
    unregisterSource(CRADLE_ISSUE_STATUS_AWAIT_SOURCE)
    delete process.env.GITHUB_TOKEN
    resetTokenCache()
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
  })

  function seedSession(): { workspaceId: string; sessionId: string } {
    const d = db()
    const workspaceId = randomUUID()
    const providerTargetId = randomUUID()
    const sessionId = randomUUID()

    d.insert(workspaces)
      .values({
        id: workspaceId,
        name: 'ws',
        locatorJson: JSON.stringify({ kind: 'local', path: '/tmp/ws' })
      })
      .run()
    d.insert(providerTargets)
      .values({
        id: providerTargetId,
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'p'
      })
      .run()
    d.insert(sessions)
      .values({
        id: sessionId,
        workspaceId,
        providerTargetId,
        title: 'test'
      })
      .run()

    return { workspaceId, sessionId }
  }

  function seedAwait(): { awaitId: string; sessionId: string } {
    const { workspaceId, sessionId } = seedSession()
    const awaitId = randomUUID()

    db()
      .insert(sessionAwaits)
      .values({
        id: awaitId,
        chatSessionId: sessionId,
        workspaceId,
        source: 'github-ci',
        status: 'pending',
        filterJson: '{}'
      })
      .run()

    return { awaitId, sessionId }
  }

  function seedDelegatedIssue(
    workspaceId: string,
    input: {
      title?: string
      agentSessionId?: string
      status?: 'created' | 'active' | 'completed' | 'stopped' | 'failed'
      createdAt?: number
    } = {}
  ): { issueId: string; agentId: string; providerTargetId: string; agentSessionId: string } {
    const now = Math.floor(Date.now() / 1000)
    const providerTargetId = `provider-${randomUUID()}`
    const agentId = `agent-${randomUUID()}`
    const issue = Issue.createIssue({
      workspaceId,
      title: input.title ?? 'Delegated child issue'
    })

    db()
      .insert(providerTargets)
      .values({
        id: providerTargetId,
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Issue Worker Provider',
        enabled: true
      })
      .run()
    db()
      .insert(agents)
      .values({
        id: agentId,
        name: 'Issue Worker',
        avatarSeed: 'issue-worker',
        providerTargetId,
        runtimeKind: 'standard',
        enabled: true,
        createdAt: now,
        updatedAt: now
      })
      .run()
    Issue.updateIssueDelegation(issue.id, { agentId, providerTargetId })

    const agentSessionId = input.agentSessionId ?? `agent-session-${randomUUID()}`
    db()
      .insert(agentSessions)
      .values({
        id: agentSessionId,
        issueId: issue.id,
        providerTargetId,
        agentId,
        chatSessionId: null,
        status: input.status ?? 'active',
        createdAt: input.createdAt ?? now,
        updatedAt: input.createdAt ?? now
      })
      .run()

    return { issueId: issue.id, agentId, providerTargetId, agentSessionId }
  }

  it('marks delivery failures as retryable and stores the resume message', async () => {
    const { awaitId } = seedAwait()

    mockedEnqueueSessionQueueItem.mockRejectedValueOnce(
      new AppError({
        code: 'chat_session_not_found',
        status: 404,
        message: 'Chat session not found'
      })
    )

    const result = await trigger({
      awaitId,
      resumeText: 'CI passed'
    })

    expect(result).not.toBeNull()
    expect(result!.status).toBe('failed')
    expect(result!.failureKind).toBe('delivery')
    expect(result!.resumeText).toBe('CI passed')
    expect(result!.lastErrorText).toContain('not found')
  })

  it('retries failed delivery without waiting for the external source again', async () => {
    const { awaitId, sessionId } = seedAwait()

    mockedEnqueueSessionQueueItem
      .mockRejectedValueOnce(new Error('Queue unavailable'))
      .mockResolvedValueOnce({} as never)

    const failed = await trigger({
      awaitId,
      resumeText: 'CI passed',
      resumePayloadJson: '{"state":"success"}'
    })

    expect(failed).toEqual(
      expect.objectContaining({
        status: 'failed',
        failureKind: 'delivery',
        resumeText: 'CI passed',
        resumePayloadJson: '{"state":"success"}'
      })
    )

    const retried = await retryDelivery({ awaitId })

    expect(retried).toEqual(
      expect.objectContaining({
        status: 'triggered',
        failureKind: null,
        lastErrorText: null,
        resumeText: 'CI passed',
        resumePayloadJson: '{"state":"success"}'
      })
    )
    expect(mockedEnqueueSessionQueueItem).toHaveBeenLastCalledWith({
      sessionId,
      text: 'CI passed'
    })
  })

  it('does not retry source failures through the delivery retry path', async () => {
    const { awaitId } = seedAwait()
    db()
      .update(sessionAwaits)
      .set({
        status: 'failed',
        failureKind: 'source',
        lastErrorText: 'GitHub CI target not found'
      })
      .where(eq(sessionAwaits.id, awaitId))
      .run()

    const retried = await retryDelivery({
      awaitId,
      resumeText: 'Proceed anyway'
    })

    expect(retried).toBeNull()
    expect(mockedEnqueueSessionQueueItem).not.toHaveBeenCalled()
  })

  it('marks as triggered and enqueues the resume message when dispatch succeeds', async () => {
    const { awaitId, sessionId } = seedAwait()

    mockedEnqueueSessionQueueItem.mockResolvedValueOnce({} as never)

    const result = await trigger({
      awaitId,
      resumeText: 'CI passed'
    })

    expect(result).not.toBeNull()
    expect(result!.status).toBe('triggered')
    expect(result!.failureKind).toBeNull()
    expect(result!.resumeText).toBe('CI passed')
    expect(mockedEnqueueSessionQueueItem).toHaveBeenCalledWith({
      sessionId,
      text: 'CI passed'
    })
  })

  it('rejects blank resume messages before dispatch', async () => {
    const { awaitId } = seedAwait()

    await expect(
      trigger({
        awaitId,
        resumeText: '   '
      })
    ).rejects.toThrow('resumeText must include non-whitespace content')

    expect(mockedEnqueueSessionQueueItem).not.toHaveBeenCalled()
  })

  it('does not deliver empty resume messages from a matched source adapter', async () => {
    const { workspaceId, sessionId } = seedSession()
    const awaitId = randomUUID()

    db()
      .insert(sessionAwaits)
      .values({
        id: awaitId,
        chatSessionId: sessionId,
        workspaceId,
        source: 'test-source',
        status: 'pending',
        filterJson: '{}'
      })
      .run()

    registerSource({
      source: 'test-source',
      async checkPending() {
        return [{ awaitId, matched: true, resumeText: '   ' }]
      }
    })

    await runOnce()

    const row = db().select().from(sessionAwaits).where(eq(sessionAwaits.id, awaitId)).get()
    expect(row).toEqual(
      expect.objectContaining({
        status: 'failed',
        failureKind: 'source',
        lastErrorText: 'Source adapter matched without a resume message'
      })
    )
    expect(mockedEnqueueSessionQueueItem).not.toHaveBeenCalled()
  })

  it('checks pending awaits when a source run is explicitly requested', async () => {
    const { workspaceId, sessionId } = seedSession()
    const awaitId = randomUUID()

    db()
      .insert(sessionAwaits)
      .values({
        id: awaitId,
        chatSessionId: sessionId,
        workspaceId,
        source: 'test-source',
        status: 'pending',
        filterJson: '{}'
      })
      .run()

    const checkPending = vi.fn(async () => [{ awaitId, matched: false as const }])
    registerSource({
      source: 'test-source',
      checkPending
    })

    requestRun()

    await vi.waitFor(() => {
      expect(checkPending).toHaveBeenCalledTimes(1)
    })
    const row = db().select().from(sessionAwaits).where(eq(sessionAwaits.id, awaitId)).get()
    expect(row?.lastCheckedAt).toEqual(expect.any(Number))
  })

  it('rejects unsupported await sources instead of creating pending records without a poller', async () => {
    const { workspaceId, sessionId } = seedSession()

    await expect(
      register({
        chatSessionId: sessionId,
        workspaceId,
        source: 'slack-thread',
        filterJson: '{}'
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'session_await_source_unsupported',
        details: {
          supportedSources: [
            'github-ci',
            'github-review',
            'manual',
            'timer',
            CRADLE_ISSUE_AGENT_AWAIT_SOURCE,
            CRADLE_ISSUE_STATUS_AWAIT_SOURCE
          ]
        }
      })
    )
    expect(db().select().from(sessionAwaits).all()).toHaveLength(0)
  })

  it('allows manual awaits as explicit trigger-only waits', async () => {
    const { workspaceId, sessionId } = seedSession()

    const result = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: 'manual',
      filterJson: '{}',
      reason: 'Waiting for a human to trigger this session'
    })

    expect(result).toEqual(
      expect.objectContaining({
        chatSessionId: sessionId,
        source: 'manual',
        status: 'pending'
      })
    )
  })

  it('rejects invalid timer and fireAt combinations', async () => {
    const { workspaceId, sessionId } = seedSession()

    await expect(
      register({
        chatSessionId: sessionId,
        workspaceId,
        source: 'timer',
        filterJson: '{}'
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'session_await_timer_fire_at_required'
      })
    )

    await expect(
      register({
        chatSessionId: sessionId,
        workspaceId,
        source: 'manual',
        filterJson: '{}',
        fireAt: 200
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'session_await_fire_at_unsupported'
      })
    )
  })

  it('handles zero-valued timer timestamps as valid due times', async () => {
    const { workspaceId, sessionId } = seedSession()

    const result = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: 'timer',
      filterJson: '{}',
      fireAt: 0
    })

    expect(result).toEqual(
      expect.objectContaining({
        source: 'timer',
        fireAt: 0,
        status: 'pending'
      })
    )
  })

  it('rejects issue-agent awaits when an issue has no current delegation', async () => {
    const { workspaceId, sessionId } = seedSession()
    const issue = Issue.createIssue({
      workspaceId,
      title: 'Not delegated yet'
    })

    await expect(
      register({
        chatSessionId: sessionId,
        workspaceId,
        source: CRADLE_ISSUE_AGENT_AWAIT_SOURCE,
        filterJson: JSON.stringify({
          issueIds: [issue.id],
          mode: 'all-current-delegations'
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'cradle_issue_agent_await_target_invalid'
      })
    )
  })

  it('stores issue-agent awaits as current delegation snapshots and does not drift to newer sessions', async () => {
    const { workspaceId, sessionId } = seedSession()
    const delegated = seedDelegatedIssue(workspaceId, {
      title: 'Worker target',
      agentSessionId: 'agent-session-original',
      status: 'active',
      createdAt: 100
    })

    const row = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: CRADLE_ISSUE_AGENT_AWAIT_SOURCE,
      filterJson: JSON.stringify({
        issueIds: [delegated.issueId],
        mode: 'all-current-delegations'
      })
    })

    expect(JSON.parse(row.filterJson)).toEqual({
      mode: 'all-current-delegations',
      issues: [
        {
          issueId: delegated.issueId,
          agentSessionId: 'agent-session-original'
        }
      ]
    })

    db()
      .insert(agentSessions)
      .values({
        id: 'agent-session-newer',
        issueId: delegated.issueId,
        providerTargetId: delegated.providerTargetId,
        agentId: delegated.agentId,
        chatSessionId: null,
        status: 'completed',
        createdAt: 200,
        updatedAt: 200
      })
      .run()

    await runOnce()

    expect(db().select().from(sessionAwaits).where(eq(sessionAwaits.id, row.id)).get()).toEqual(
      expect.objectContaining({
        status: 'pending'
      })
    )
    expect(mockedEnqueueSessionQueueItem).not.toHaveBeenCalled()

    db()
      .update(agentSessions)
      .set({ status: 'completed' })
      .where(eq(agentSessions.id, 'agent-session-original'))
      .run()

    mockedEnqueueSessionQueueItem.mockResolvedValueOnce({} as never)
    await runOnce()

    expect(db().select().from(sessionAwaits).where(eq(sessionAwaits.id, row.id)).get()).toEqual(
      expect.objectContaining({
        status: 'triggered',
        failureKind: null
      })
    )
    expect(mockedEnqueueSessionQueueItem).toHaveBeenCalledWith({
      sessionId,
      text: expect.stringContaining('Cradle issue agent work finished.')
    })
  })

  it('wakes parent sessions when delegated issue-agent work failed or stopped', async () => {
    const { workspaceId, sessionId } = seedSession()
    const failed = seedDelegatedIssue(workspaceId, {
      title: 'Failed child',
      agentSessionId: 'agent-session-failed',
      status: 'failed'
    })
    const stopped = seedDelegatedIssue(workspaceId, {
      title: 'Stopped child',
      agentSessionId: 'agent-session-stopped',
      status: 'stopped'
    })

    const row = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: CRADLE_ISSUE_AGENT_AWAIT_SOURCE,
      filterJson: JSON.stringify({
        issueIds: [failed.issueId, stopped.issueId],
        mode: 'all-current-delegations'
      })
    })

    mockedEnqueueSessionQueueItem.mockResolvedValueOnce({} as never)
    await runOnce()

    const updated = db().select().from(sessionAwaits).where(eq(sessionAwaits.id, row.id)).get()
    expect(updated).toEqual(
      expect.objectContaining({
        status: 'triggered',
        failureKind: null
      })
    )
    expect(updated?.resumeText).toContain('failed')
    expect(updated?.resumeText).toContain('stopped')
    expect(JSON.parse(updated?.resumePayloadJson ?? '{}')).toEqual(
      expect.objectContaining({
        source: CRADLE_ISSUE_AGENT_AWAIT_SOURCE,
        results: expect.arrayContaining([
          expect.objectContaining({ agentSessionId: 'agent-session-failed', status: 'failed' }),
          expect.objectContaining({ agentSessionId: 'agent-session-stopped', status: 'stopped' })
        ])
      })
    )
  })

  it('waits for all issues to reach a completed status category', async () => {
    const { workspaceId, sessionId } = seedSession()
    const first = Issue.createIssue({ workspaceId, title: 'First status target' })
    const second = Issue.createIssue({ workspaceId, title: 'Second status target' })

    const row = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: CRADLE_ISSUE_STATUS_AWAIT_SOURCE,
      filterJson: JSON.stringify({
        issueIds: [first.id, second.id],
        mode: 'all',
        categories: ['completed']
      })
    })

    await runOnce()
    expect(db().select().from(sessionAwaits).where(eq(sessionAwaits.id, row.id)).get()).toEqual(
      expect.objectContaining({
        status: 'pending'
      })
    )

    Issue.moveIssueToStatusName(first.id, 'Done')
    await runOnce()
    expect(db().select().from(sessionAwaits).where(eq(sessionAwaits.id, row.id)).get()).toEqual(
      expect.objectContaining({
        status: 'pending'
      })
    )

    mockedEnqueueSessionQueueItem.mockResolvedValueOnce({} as never)
    Issue.moveIssueToStatusName(second.id, 'Done')
    await runOnce()

    const updated = db().select().from(sessionAwaits).where(eq(sessionAwaits.id, row.id)).get()
    expect(updated).toEqual(
      expect.objectContaining({
        status: 'triggered',
        failureKind: null
      })
    )
    expect(JSON.parse(updated?.resumePayloadJson ?? '{}')).toEqual(
      expect.objectContaining({
        source: CRADLE_ISSUE_STATUS_AWAIT_SOURCE,
        mode: 'all',
        results: expect.arrayContaining([
          expect.objectContaining({ issueId: first.id, category: 'completed', matched: true }),
          expect.objectContaining({ issueId: second.id, category: 'completed', matched: true })
        ])
      })
    )
  })

  it('supports any-mode issue status awaits', async () => {
    const { workspaceId, sessionId } = seedSession()
    const first = Issue.createIssue({ workspaceId, title: 'Any first' })
    const second = Issue.createIssue({ workspaceId, title: 'Any second' })
    const doneStatusId = Issue.resolveStatusNames(workspaceId, ['Done'])[0]!.id

    const row = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: CRADLE_ISSUE_STATUS_AWAIT_SOURCE,
      filterJson: JSON.stringify({
        issueIds: [first.id, second.id],
        mode: 'any',
        statusNames: ['Done']
      })
    })

    mockedEnqueueSessionQueueItem.mockResolvedValueOnce({} as never)
    Issue.moveIssueToStatusName(second.id, 'Done')
    await runOnce()

    const updated = db().select().from(sessionAwaits).where(eq(sessionAwaits.id, row.id)).get()
    expect(updated).toEqual(
      expect.objectContaining({
        status: 'triggered',
        failureKind: null
      })
    )
    expect(JSON.parse(updated?.filterJson ?? '{}')).toEqual({
      issueIds: [first.id, second.id],
      mode: 'any',
      statusIds: [doneStatusId]
    })
  })

  it('uses stable pending ordering for list and summary projections', () => {
    const { workspaceId, sessionId } = seedSession()

    db()
      .insert(sessionAwaits)
      .values([
        {
          id: 'await-newer',
          chatSessionId: sessionId,
          workspaceId,
          source: 'manual',
          status: 'pending',
          filterJson: '{}',
          reason: 'Second wait',
          createdAt: 200
        },
        {
          id: 'await-older',
          chatSessionId: sessionId,
          workspaceId,
          source: 'manual',
          status: 'pending',
          filterJson: '{}',
          reason: 'First wait',
          createdAt: 100
        }
      ])
      .run()

    expect(getSessionSummary(sessionId)).toEqual(
      expect.objectContaining({
        awaiting: true,
        pendingCount: 2,
        primaryAwaitId: 'await-older',
        reason: 'First wait'
      })
    )
    expect(listBySession(sessionId).map((row) => row.id)).toEqual(['await-newer', 'await-older'])
  })

  it('rejects GitHub CI registration when the commit target is not found', async () => {
    process.env.GITHUB_TOKEN = 'token'
    resetTokenCache()
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        })
    ) as typeof fetch

    const { workspaceId, sessionId } = seedSession()

    await expect(
      register({
        chatSessionId: sessionId,
        workspaceId,
        source: 'github-ci',
        filterJson: JSON.stringify({ repo: 'acme/app', sha: 'missing-sha' })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'github_await_target_invalid',
        message: 'GitHub CI target not found or inaccessible: acme/app commit missing-sha.'
      })
    )
    expect(db().select().from(sessionAwaits).all()).toHaveLength(0)
  })

  it('returns a product error when available checks cannot read the repo', async () => {
    process.env.GITHUB_TOKEN = 'token'
    resetTokenCache()
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        })
    ) as typeof fetch

    await expect(fetchAvailableChecks('acme', 'missing')).rejects.toEqual(
      expect.objectContaining({
        code: 'github_repo_not_found',
        status: 404,
        message: 'Repository acme/missing not found or inaccessible'
      })
    )
  })
})
