// Integration tests for the `javascript` session await source: registration
// validation, pending/triggered outcomes, consecutive-error accounting, and
// resume-on-terminal-failure delivery.

import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { providerTargets, sessionAwaits, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../src/infra'
import { enqueueSessionQueueItem } from '../src/modules/chat-runtime/runtime'
import {
  flushHeavyCheckQueue,
  registerSource,
  runOnce,
  runOnceAndFlush,
  unregisterSource,
} from '../src/modules/session-await/poller'
import { cancel, register } from '../src/modules/session-await/service'
import {
  JAVASCRIPT_AWAIT_SOURCE,
  javascriptAwaitSource,
} from '../src/modules/session-await/sources/javascript'

vi.mock('../src/modules/chat-runtime/runtime', () => ({
  enqueueSessionQueueItem: vi.fn(),
}))

const mockedEnqueueSessionQueueItem = vi.mocked(enqueueSessionQueueItem)

const PENDING_PROGRAM = 'async () => false'
const BROKEN_PROGRAM = `export default async () => { throw new Error('always broken') }`

describe('javascript session await', () => {
  let dataDir: string
  let workspaceDirs: string[]

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-js-await-test-'))
    workspaceDirs = []
    process.env.CRADLE_DATA_DIR = dataDir
    mockedEnqueueSessionQueueItem.mockReset()
    mockedEnqueueSessionQueueItem.mockResolvedValue({} as never)
    registerSource(javascriptAwaitSource)
  })

  afterEach(async () => {
    unregisterSource(JAVASCRIPT_AWAIT_SOURCE)
    await flushHeavyCheckQueue()
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    for (const dir of workspaceDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function seedSession(): { workspaceId: string, sessionId: string } {
    const d = db()
    const workspaceId = randomUUID()
    const providerTargetId = randomUUID()
    const sessionId = randomUUID()
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cradle-js-await-ws-'))
    workspaceDirs.push(workspaceDir)

    d.insert(workspaces)
      .values({
        id: workspaceId,
        name: 'ws',
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceDir, kind: 'project' }),
      })
      .run()
    d.insert(providerTargets)
      .values({
        id: providerTargetId,
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'p',
      })
      .run()
    d.insert(sessions)
      .values({
        id: sessionId,
        workspaceId,
        providerTargetId,
        title: 'test',
      })
      .run()

    return { workspaceId, sessionId }
  }

  function readAwait(awaitId: string) {
    return db().select().from(sessionAwaits).where(eq(sessionAwaits.id, awaitId)).get()
  }

  function updateProgram(awaitId: string, program: string) {
    db()
      .update(sessionAwaits)
      .set({ filterJson: JSON.stringify({ program }) })
      .where(eq(sessionAwaits.id, awaitId))
      .run()
  }

  // Queued checks honor pollIntervalMs via lastCheckedAt; clear it so the next
  // cycle is immediately due in tight test loops.
  function makeDue(awaitId: string) {
    db()
      .update(sessionAwaits)
      .set({ lastCheckedAt: null })
      .where(eq(sessionAwaits.id, awaitId))
      .run()
  }

  it('rejects registration of a program with a syntax error', async () => {
    const { workspaceId, sessionId } = seedSession()

    await expect(
      register({
        chatSessionId: sessionId,
        workspaceId,
        source: JAVASCRIPT_AWAIT_SOURCE,
        filterJson: JSON.stringify({ program: 'export default async () => {' }),
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: 'session_await_program_invalid' }),
    )
    expect(db().select().from(sessionAwaits).all()).toHaveLength(0)
  })

  it('enforces the program limit in UTF-8 bytes', async () => {
    const { workspaceId, sessionId } = seedSession()
    const program = `${'// 😀\n'.repeat(9_000)}async () => false`
    expect(program.length).toBeLessThan(64 * 1024)
    expect(Buffer.byteLength(program, 'utf8')).toBeGreaterThan(64 * 1024)

    await expect(register({
      chatSessionId: sessionId,
      workspaceId,
      source: JAVASCRIPT_AWAIT_SOURCE,
      filterJson: JSON.stringify({ program }),
    })).rejects.toEqual(expect.objectContaining({ code: 'session_await_program_invalid' }))
  })

  it('keeps the await pending and the error counter at zero while the cell returns false', async () => {
    const { workspaceId, sessionId } = seedSession()
    const row = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: JAVASCRIPT_AWAIT_SOURCE,
      filterJson: JSON.stringify({ program: PENDING_PROGRAM }),
    })

    await runOnceAndFlush()

    expect(readAwait(row.id)).toEqual(
      expect.objectContaining({
        status: 'pending',
        consecutiveErrorCount: 0,
        lastErrorText: null,
      }),
    )
    expect(mockedEnqueueSessionQueueItem).not.toHaveBeenCalled()
  })

  it('triggers the await and enqueues the resume message when the cell completes', async () => {
    const { workspaceId, sessionId } = seedSession()
    const row = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: JAVASCRIPT_AWAIT_SOURCE,
      filterJson: JSON.stringify({
        program: `export default async () => ({ resumeText: 'CI done', payload: { conclusion: 'success' } })`,
      }),
    })

    await runOnceAndFlush()

    expect(readAwait(row.id)).toEqual(
      expect.objectContaining({
        status: 'triggered',
        resumeText: 'CI done',
        resumePayloadJson: '{"conclusion":"success"}',
      }),
    )
    expect(mockedEnqueueSessionQueueItem).toHaveBeenCalledWith({
      sessionId,
      text: 'CI done',
    })
  })

  it('counts consecutive evaluation errors and fails with a failure resume after five', async () => {
    const { workspaceId, sessionId } = seedSession()
    const row = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: JAVASCRIPT_AWAIT_SOURCE,
      filterJson: JSON.stringify({ program: BROKEN_PROGRAM }),
    })

    for (let cycle = 1; cycle <= 4; cycle++) {
      makeDue(row.id)
      await runOnceAndFlush()
      expect(readAwait(row.id)).toEqual(
        expect.objectContaining({
          status: 'pending',
          consecutiveErrorCount: cycle,
          lastErrorText: 'always broken',
        }),
      )
      expect(mockedEnqueueSessionQueueItem).not.toHaveBeenCalled()
    }

    makeDue(row.id)
    await runOnceAndFlush()

    const failed = readAwait(row.id)
    expect(failed).toEqual(
      expect.objectContaining({
        status: 'failed',
        failureKind: 'source',
        consecutiveErrorCount: 5,
      }),
    )
    expect(failed?.lastErrorText).toContain('Evaluation failed 5 times consecutively')
    expect(failed?.lastErrorText).toContain('always broken')
    expect(mockedEnqueueSessionQueueItem).toHaveBeenCalledWith({
      sessionId,
      text: expect.stringContaining('Session await (javascript) failed'),
    })
  })

  it('fails immediately and enqueues a failure resume when the cell result is invalid', async () => {
    const { workspaceId, sessionId } = seedSession()
    const row = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: JAVASCRIPT_AWAIT_SOURCE,
      filterJson: JSON.stringify({ program: 'export default async () => true' }),
    })

    await runOnceAndFlush()

    expect(readAwait(row.id)).toEqual(
      expect.objectContaining({
        status: 'failed',
        failureKind: 'source',
      }),
    )
    expect(readAwait(row.id)?.lastErrorText).toContain('Cell returned an invalid result')
    expect(mockedEnqueueSessionQueueItem).toHaveBeenCalledWith({
      sessionId,
      text: expect.stringContaining('Session await (javascript) failed'),
    })
  })

  it('fails a stored program error immediately instead of retrying it', async () => {
    const { workspaceId, sessionId } = seedSession()
    const row = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: JAVASCRIPT_AWAIT_SOURCE,
      filterJson: JSON.stringify({ program: PENDING_PROGRAM }),
    })
    updateProgram(row.id, 'export default 42')

    await runOnceAndFlush()

    expect(readAwait(row.id)).toEqual(expect.objectContaining({
      status: 'failed',
      failureKind: 'source',
      consecutiveErrorCount: 0,
    }))
    expect(readAwait(row.id)?.lastErrorText).toContain('Program must export a default function')
    expect(mockedEnqueueSessionQueueItem).toHaveBeenCalledTimes(1)
  })

  it('does not resume a terminal failure when cancellation wins the race', async () => {
    const { workspaceId, sessionId } = seedSession()
    const markerName = 'evaluation-started'
    const row = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: JAVASCRIPT_AWAIT_SOURCE,
      filterJson: JSON.stringify({
        program: `
          import { writeFileSync } from 'node:fs'
          export default async () => {
            writeFileSync(${JSON.stringify(markerName)}, 'started')
            await new Promise(resolve => setTimeout(resolve, 300))
            return true
          }
        `,
      }),
    })
    const workspacePath = db().select({ locatorJson: workspaces.locatorJson }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()!
    const markerPath = join(JSON.parse(workspacePath.locatorJson).path, markerName)

    // Enqueue without awaiting the heavy check so cancel can win mid-evaluation.
    await runOnce()
    await vi.waitFor(() => expect(existsSync(markerPath)).toBe(true))
    expect(cancel(row.id)?.status).toBe('cancelled')
    await flushHeavyCheckQueue()

    expect(readAwait(row.id)?.status).toBe('cancelled')
    expect(mockedEnqueueSessionQueueItem).not.toHaveBeenCalled()
  })

  it('resets the consecutive error counter after a clean evaluation', async () => {
    const { workspaceId, sessionId } = seedSession()
    const row = await register({
      chatSessionId: sessionId,
      workspaceId,
      source: JAVASCRIPT_AWAIT_SOURCE,
      filterJson: JSON.stringify({ program: BROKEN_PROGRAM }),
    })

    await runOnceAndFlush()
    expect(readAwait(row.id)).toEqual(
      expect.objectContaining({ status: 'pending', consecutiveErrorCount: 1 }),
    )

    updateProgram(row.id, PENDING_PROGRAM)
    makeDue(row.id)
    await runOnceAndFlush()

    expect(readAwait(row.id)).toEqual(
      expect.objectContaining({
        status: 'pending',
        consecutiveErrorCount: 0,
        lastErrorText: null,
      }),
    )
    expect(mockedEnqueueSessionQueueItem).not.toHaveBeenCalled()
  })

  it('does not block the poller cycle on javascript evaluation', async () => {
    const { workspaceId, sessionId } = seedSession()
    await register({
      chatSessionId: sessionId,
      workspaceId,
      source: JAVASCRIPT_AWAIT_SOURCE,
      filterJson: JSON.stringify({
        program: `
          export default async () => {
            await new Promise(resolve => setTimeout(resolve, 400))
            return false
          }
        `,
      }),
    })

    const startedAt = Date.now()
    await runOnce()
    expect(Date.now() - startedAt).toBeLessThan(200)
    await flushHeavyCheckQueue()
  })
})
