import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions } from '@cradle/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import type { ActiveRun } from '../run-registry'
import { createRunChunkSequencer } from '../stream/run-chunk-sequencer'
import { createFinalMessageProjectionState } from './final-message-projection'
import type { RunWriteFence } from './run-write-fence'

const { commitPreparedSessionEventsWithProjection, readRunWriteFence } = vi.hoisted(() => ({
  commitPreparedSessionEventsWithProjection: vi.fn(),
  readRunWriteFence: vi.fn<(runId: string) => RunWriteFence>(() => ({ status: 'streaming' })),
}))

vi.mock('../es/commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('../es/commands')>()
  return { ...original, commitPreparedSessionEventsWithProjection }
})

vi.mock('./run-write-fence', async (importOriginal) => {
  const original = await importOriginal<typeof import('./run-write-fence')>()
  return { ...original, readRunWriteFence }
})

const { createTerminalRunFinalizer } = await import('./terminal-finalizer')

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

function activeRun(): ActiveRun {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    messageId: 'assistant-1',
    startedAtSeconds: 0,
    providerTargetKind: null,
    providerTargetId: null,
    runtime: {} as ActiveRun['runtime'],
    runtimeSession: {
      id: 'runtime-session-1',
      chatSessionId: 'session-1',
      providerTargetId: null,
      runtimeKind: 'standard',
      providerSessionId: null,
      providerStateSnapshot: null,
    },
    modelId: null,
    runChunkSequencer: createRunChunkSequencer('run-1'),
    pendingDeltaChunk: null,
    pendingDeltaFlushTimer: null,
    snapshotTimer: null,
    finalMessage: { id: 'assistant-1', role: 'assistant', parts: [] },
    finalProjection: createFinalMessageProjectionState(),
    runtimeSettings: {} as ActiveRun['runtimeSettings'],
    usageEventCount: 0,
    usageEventAggregate: null,
    runSnapshotSeq: 0,
    snapshotEventIdByCoalesceKey: new Map(),
    runSnapshotDroppedEventCount: 0,
  }
}

describe('terminal finalizer durability barrier', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    commitPreparedSessionEventsWithProjection.mockReset()
    readRunWriteFence.mockReset()
    readRunWriteFence.mockReturnValue({ status: 'streaming' as const })
  })

  it('rejects and leaves the live run non-terminal when durable terminal persistence fails', async () => {
    commitPreparedSessionEventsWithProjection.mockRejectedValueOnce(new Error('terminal write failed'))
    const run = activeRun()
    const publishUIMessageChunk = vi.fn()
    const finalizer = createTerminalRunFinalizer({
      stream: {
        publishRunStartChunk: vi.fn(),
        flushPendingRunDelta: vi.fn(),
        publishUIMessageChunk,
      },
      error: vi.fn(),
    })

    await expect(
      finalizer.persistTerminalChunk(run, { type: 'finish', finishReason: 'stop' }),
    ).rejects.toThrow('terminal write failed')
    expect(run.terminalStatus).toBeUndefined()
    expect(run.terminalAtMs).toBeUndefined()
    expect(publishUIMessageChunk).not.toHaveBeenCalled()
  })

  it('publishes the durable terminal timestamp onto the active run', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(9_000)
    let messageJson = ''
    commitPreparedSessionEventsWithProjection.mockImplementationOnce(
      async (_sessionId, prepare) => {
        const prepared = prepare({} as never)
        const completed = prepared.events.find(event => event.type === 'AssistantMessageCompleted')
        const payload = completed?.payload as { message?: { messageJson?: string } } | undefined
        messageJson = payload?.message?.messageJson ?? ''
        return prepared.result
      },
    )
    const run = activeRun()
    run.runStartedAtMs = 1_000
    run.admissionRequestedAtMs = 900
    run.firstResponseAtMs = 1_300
    run.firstTokenAtMs = 1_600
    run.finalResponseStartedAtMs = 6_300
    const finalizer = createTerminalRunFinalizer({
      stream: {
        publishRunStartChunk: vi.fn(),
        flushPendingRunDelta: vi.fn(),
        publishUIMessageChunk: vi.fn(),
      },
      error: vi.fn(),
    })

    await finalizer.persistTerminalChunk(run, { type: 'finish', finishReason: 'stop' })

    expect(run.terminalAtMs).toBe(9_000)
    expect(JSON.parse(messageJson).metadata.cradle.run).toEqual({
      runId: 'run-1',
      durationMs: 8_000,
      timings: {
        acceptMs: 100,
        ttfbMs: 300,
        ttftMs: 600,
        workedMs: 4_700,
        totalMs: 8_000,
      },
    })
  })

  it('restores the durable terminal timestamp from an existing terminal fence', async () => {
    readRunWriteFence.mockReturnValueOnce({
      status: 'complete' as const,
      errorText: null,
      finishedAt: 123,
    })
    const run = activeRun()
    const finalizer = createTerminalRunFinalizer({
      stream: {
        publishRunStartChunk: vi.fn(),
        flushPendingRunDelta: vi.fn(),
        publishUIMessageChunk: vi.fn(),
      },
      error: vi.fn(),
    })

    await finalizer.persistTerminalChunk(run, { type: 'finish', finishReason: 'stop' })

    expect(run.terminalStatus).toBe('complete')
    expect(run.terminalAtMs).toBe(123_000)
    expect(commitPreparedSessionEventsWithProjection).not.toHaveBeenCalled()
  })

  it('persists an assistant message with an inline image as cradle-blob:// without base64', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-terminal-blob-'))
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousDbPath = process.env.CRADLE_DB_PATH
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_DB_PATH

    try {
      const now = Math.floor(Date.now() / 1000)
      db().insert(sessions).values({
        id: 'session-1',
        title: 'Terminal Blob Test',
        titleSource: 'initial',
        runtimeKind: 'standard',
        createdAt: now,
        updatedAt: now,
      }).run()

      const bytes = Buffer.alloc(8_192, 0x42)
      const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`
      let preparedEvents: Array<{
        type: string
        payload: { message?: { messageJson?: string } }
      }> = []
      commitPreparedSessionEventsWithProjection.mockImplementationOnce(
        async (_sessionId, prepare) => db().transaction((tx) => {
          const prepared = prepare(tx)
          preparedEvents = prepared.events
          return prepared.result
        }),
      )
      const run = activeRun()
      run.finalMessage = {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'file', mediaType: 'image/png', url: dataUrl }],
      }

      const finalizer = createTerminalRunFinalizer({
        stream: {
          publishRunStartChunk: vi.fn(),
          flushPendingRunDelta: vi.fn(),
          publishUIMessageChunk: vi.fn(),
        },
        error: vi.fn(),
      })

      await finalizer.persistTerminalChunk(run, { type: 'finish', finishReason: 'stop' })

      expect(commitPreparedSessionEventsWithProjection).toHaveBeenCalled()
      const completed = preparedEvents.find(event => event.type === 'AssistantMessageCompleted')
      const messageJson = completed?.payload.message?.messageJson ?? ''
      expect(messageJson).toContain('cradle-blob://')
      expect(messageJson).not.toContain('base64')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_DB_PATH', previousDbPath)
    }
  })
})
