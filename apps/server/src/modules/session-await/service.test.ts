// Module tests for session-await lifecycle invariants: idempotent trigger,
// terminal-state guards, poller expiry/timer transitions, tracked evaluation
// error counting, and bypass glob semantics. The Chat Runtime delivery seam is
// stubbed so no provider is involved.

import { randomUUID } from 'node:crypto'

import { providerTargets, sessionAwaits, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../infra'
import { enqueueSessionQueueItem } from '../chat-runtime/runtime'
import { runOnce } from './poller'
import {
  bypassCheck,
  cancel,
  expire,
  globMatch,
  markFailed,
  matchesAnyBypassPattern,
  recordTrackedEvaluationCheck,
  recordTrackedEvaluationFailure,
  register,
  trigger,
} from './service'

vi.mock('../chat-runtime/runtime', () => ({
  enqueueSessionQueueItem: vi.fn(),
}))

const mockedEnqueue = vi.mocked(enqueueSessionQueueItem)

function seedSession(): { workspaceId: string, sessionId: string } {
  const workspaceId = randomUUID()
  const providerTargetId = randomUUID()
  const sessionId = randomUUID()

  db().insert(workspaces).values({
    id: workspaceId,
    name: 'ws',
    // locator_json is uniquely indexed — each seed needs a distinct path.
    locatorJson: JSON.stringify({ nodeId: 'local', path: `/tmp/session-await-${workspaceId}` }),
  }).run()
  db().insert(providerTargets).values({
    id: providerTargetId,
    kind: 'manual',
    providerKind: 'openai-compatible',
    displayName: 'p',
  }).run()
  db().insert(sessions).values({
    id: sessionId,
    workspaceId,
    providerTargetId,
    title: 'await-module-test',
  }).run()

  return { workspaceId, sessionId }
}

function seedAwait(overrides: Partial<typeof sessionAwaits.$inferInsert> = {}): {
  awaitId: string
  sessionId: string
} {
  const { workspaceId, sessionId } = seedSession()
  const awaitId = randomUUID()
  db().insert(sessionAwaits).values({
    id: awaitId,
    chatSessionId: sessionId,
    workspaceId,
    source: 'manual',
    status: 'pending',
    filterJson: '{}',
    ...overrides,
  }).run()
  return { awaitId, sessionId }
}

function readAwait(awaitId: string) {
  return db().select().from(sessionAwaits).where(eq(sessionAwaits.id, awaitId)).get()
}

describe('session-await service lifecycle', () => {
  beforeEach(() => {
    mockedEnqueue.mockReset()
    mockedEnqueue.mockResolvedValue({} as never)
  })

  afterEach(() => {
    db().delete(sessionAwaits).run()
    db().delete(sessions).run()
    db().delete(providerTargets).run()
    db().delete(workspaces).run()
  })

  it('treats a second trigger as idempotent and delivers the resume exactly once', async () => {
    const { awaitId, sessionId } = seedAwait()

    const first = await trigger({ awaitId, resumeText: 'first result' })
    expect(first).toEqual(expect.objectContaining({
      status: 'triggered',
      resumeText: 'first result',
    }))

    const second = await trigger({ awaitId, resumeText: 'second result must not win' })
    expect(second).toEqual(expect.objectContaining({
      status: 'triggered',
      resumeText: 'first result',
      triggeredAt: first!.triggeredAt,
    }))

    expect(mockedEnqueue).toHaveBeenCalledTimes(1)
    expect(mockedEnqueue).toHaveBeenCalledWith({ sessionId, text: 'first result' })
  })

  it('refuses to trigger cancelled or expired awaits', async () => {
    const { awaitId } = seedAwait()
    expect(cancel(awaitId)).toEqual(expect.objectContaining({ status: 'cancelled' }))
    expect(await trigger({ awaitId, resumeText: 'too late' })).toBeNull()

    const expired = seedAwait()
    expect(expire(expired.awaitId)).toEqual(expect.objectContaining({ status: 'expired' }))
    expect(await trigger({ awaitId: expired.awaitId, resumeText: 'too late' })).toBeNull()

    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('only transitions pending rows through cancel/expire/markFailed', async () => {
    const { awaitId } = seedAwait()
    await trigger({ awaitId, resumeText: 'done' })

    expect(cancel(awaitId)).toBeNull()
    expect(expire(awaitId)).toBeNull()
    expect(markFailed(awaitId, 'source broke')).toBeNull()

    expect(readAwait(awaitId)).toEqual(expect.objectContaining({
      status: 'triggered',
      failureKind: null,
      resumeText: 'done',
    }))
  })

  it('auto-expires past-due awaits during a poller cycle without delivering them', async () => {
    const now = Math.floor(Date.now() / 1000)
    const pastDue = seedAwait({ expiresAt: now - 60 })
    const stillValid = seedAwait({ expiresAt: now + 3600 })

    await runOnce()

    expect(readAwait(pastDue.awaitId)?.status).toBe('expired')
    expect(readAwait(stillValid.awaitId)?.status).toBe('pending')
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('fires due timer awaits from the poller and leaves future timers pending', async () => {
    const now = Math.floor(Date.now() / 1000)
    const { workspaceId, sessionId } = seedSession()
    const due = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: 'timer',
      filterJson: '{}',
      fireAt: now - 10,
    })
    const future = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: 'timer',
      filterJson: '{}',
      fireAt: now + 3600,
    })

    await runOnce()

    expect(readAwait(due.id)).toEqual(expect.objectContaining({
      status: 'triggered',
      resumeText: 'Timer fired',
    }))
    expect(readAwait(future.id)?.status).toBe('pending')
    expect(mockedEnqueue).toHaveBeenCalledTimes(1)
    expect(mockedEnqueue).toHaveBeenCalledWith({ sessionId, text: 'Timer fired' })
  })

  it('fails a tracked await after five consecutive evaluation errors and resets on a clean check', () => {
    const { awaitId } = seedAwait({ source: 'javascript', consecutiveErrorCount: 3 })

    const fourth = recordTrackedEvaluationFailure(awaitId, 'boom')
    expect(fourth).toEqual(expect.objectContaining({
      status: 'pending',
      consecutiveErrorCount: 4,
      lastErrorText: 'boom',
    }))

    const fifth = recordTrackedEvaluationFailure(awaitId, 'boom again')
    expect(fifth).toEqual(expect.objectContaining({
      status: 'failed',
      failureKind: 'source',
      consecutiveErrorCount: 5,
    }))
    expect(fifth?.lastErrorText).toContain('Evaluation failed 5 times consecutively')

    // Terminal rows are no longer touched by the tracked failure path.
    expect(recordTrackedEvaluationFailure(awaitId, 'after terminal')).toBeNull()

    const recovering = seedAwait({ source: 'javascript', consecutiveErrorCount: 4 })
    recordTrackedEvaluationCheck(recovering.awaitId)
    expect(readAwait(recovering.awaitId)).toEqual(expect.objectContaining({
      status: 'pending',
      consecutiveErrorCount: 0,
      lastErrorText: null,
    }))
  })

  it('stores, keeps, and clears tracked evaluation observations per the CheckResult contract', () => {
    const { awaitId } = seedAwait({ source: 'javascript' })

    recordTrackedEvaluationCheck(awaitId, undefined, '{"progress":"halfway"}')
    expect(readAwait(awaitId)?.lastObservationJson).toBe('{"progress":"halfway"}')

    // An evaluation error (observation undefined) must leave the stored observation untouched.
    recordTrackedEvaluationCheck(awaitId, 'transient error')
    expect(readAwait(awaitId)).toEqual(expect.objectContaining({
      lastObservationJson: '{"progress":"halfway"}',
      consecutiveErrorCount: 1,
    }))

    // A clean check with observation null clears it.
    recordTrackedEvaluationCheck(awaitId, undefined, null)
    expect(readAwait(awaitId)).toEqual(expect.objectContaining({
      lastObservationJson: null,
      consecutiveErrorCount: 0,
    }))
  })

  it('records bypassed checks idempotently and matches them with glob semantics', async () => {
    const { awaitId } = seedAwait({ source: 'github-ci' })

    bypassCheck(awaitId, 'lint')
    const repeated = bypassCheck(awaitId, 'lint')
    expect(JSON.parse(repeated?.bypassedChecksJson ?? '[]')).toEqual(['lint'])

    await trigger({ awaitId, resumeText: 'CI done' })
    expect(bypassCheck(awaitId, 'another')).toBeNull()

    expect(globMatch('build-linux', 'build*')).toBe(true)
    expect(globMatch('build', 'build?')).toBe(false)
    expect(globMatch('ciXtest', 'ci.test')).toBe(false)
    expect(matchesAnyBypassPattern('e2e-smoke', ['lint', 'e2e-*'])).toBe(true)
    expect(matchesAnyBypassPattern('deploy', ['lint', 'e2e-*'])).toBe(false)
  })
})
