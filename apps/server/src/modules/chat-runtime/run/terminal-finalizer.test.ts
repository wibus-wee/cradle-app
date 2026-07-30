import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions } from '@cradle/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import type { ActiveRun } from '../run-registry'
import { createRunChunkSequencer } from '../stream/run-chunk-sequencer'
import { createFinalMessageProjectionState } from './final-message-projection'

const { commitPreparedSessionEventsWithProjection, readRunWriteFence } = vi.hoisted(() => ({
  commitPreparedSessionEventsWithProjection: vi.fn(),
  readRunWriteFence: vi.fn(() => ({ status: 'streaming' as const })),
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
    expect(publishUIMessageChunk).not.toHaveBeenCalled()
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
