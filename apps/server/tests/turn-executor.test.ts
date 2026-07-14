import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { shutdownInfra } from '../src/infra'
import { createFinalMessageProjectionState } from '../src/modules/chat-runtime/run/final-message-projection'
import type { TurnExecutorDeps } from '../src/modules/chat-runtime/run/turn-executor'
import { executeRun } from '../src/modules/chat-runtime/run/turn-executor'
import type { ActiveRun } from '../src/modules/chat-runtime/run-registry'
import type { ChatRuntime } from '../src/modules/chat-runtime/runtime-provider-types'

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-data-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  process.env.CRADLE_DATA_DIR = dataDir

  try {
    return await callback()
  }
 finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
 else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
  }
}

function createActiveRun(input: {
  runId: string
  sessionId: string
  runtime: ChatRuntime
}): ActiveRun {
  return {
    runId: input.runId,
    sessionId: input.sessionId,
    messageId: `${input.runId}-message`,
    providerTargetKind: null,
    providerTargetId: null,
    runtime: input.runtime,
    runtimeSession: {
      id: `${input.runId}-session`,
      chatSessionId: input.sessionId,
      providerTargetId: null,
      runtimeKind: 'standard',
      providerSessionId: null,
      providerStateSnapshot: null,
    } as ActiveRun['runtimeSession'],
    modelId: 'gpt-4o-mini',
    chunkBuffer: [],
    chunkBufferIndexByKey: new Map(),
    chunkBufferDroppedCount: 0,
    pendingDeltaChunk: null,
    pendingDeltaFlushTimer: null,
    snapshotTimer: null,
    finalMessage: { id: `${input.runId}-message`, role: 'assistant', parts: [] },
    finalProjection: createFinalMessageProjectionState(),
    runtimeSettings: {} as ActiveRun['runtimeSettings'],
    runSnapshotId: null,
    runSnapshotSeq: 0,
    snapshotEventIdByCoalesceKey: new Map(),
    runSnapshotTruncatedEventId: null,
    runSnapshotDroppedEventCount: 0,
  }
}

function createDeps(overrides: Partial<TurnExecutorDeps> = {}): TurnExecutorDeps {
  return {
    captureTurnCheckpointStart: vi.fn().mockResolvedValue(undefined),
    captureTurnCheckpointEnd: vi.fn().mockResolvedValue(undefined),
    stream: {
      flushPendingRunDelta: vi.fn(),
      publishRunStartChunk: vi.fn(),
      publishRuntimeChunk: vi.fn(),
    },
    publishTerminalChunk: vi.fn().mockResolvedValue(true),
    recordSnapshotEvent: vi.fn(),
    finalizeSnapshot: vi.fn(),
    releaseActiveRun: vi.fn(),
    scheduleQueueDrain: vi.fn(),
    scheduleRuntimeGoalContinuation: vi.fn(),
    pendingQueueItemCount: vi.fn().mockReturnValue(0),
    readRuntimeGoalContinuationOptions: vi.fn().mockReturnValue(undefined),
    warn: vi.fn(),
    error: vi.fn(),
    ...overrides,
  }
}

function createStreamingRuntime(chunks: UIMessageChunk[]): ChatRuntime {
  return {
    runtimeKind: 'standard',
    metadata: {},
    capabilities: {},
    async* streamTurn() {
      for (const chunk of chunks) {
        yield chunk
      }
    },
    cancelTurn: async () => {},
  } as unknown as ChatRuntime
}

describe('executeRun cancel/finalize race (turn-executor)', () => {
  it('finalizes with the true aborted status instead of a synthesized empty-output error when the run was already cancelled', async () => {
    await withTempDataDir(async () => {
      const sessionId = `session-${randomUUID()}`
      const runId = `run-${randomUUID()}`

      // The runtime still has chunks to yield, but a concurrent cancel flow
      // has *already* finalized the run as 'aborted' before the stream pump
      // gets to process them (mirrors `abortRun` racing `pumpRuntimeStream`).
      const runtime = createStreamingRuntime([
        { type: 'text-delta', id: 'text-1', delta: 'partial' },
      ])
      const activeRun = createActiveRun({ runId, sessionId, runtime })
      activeRun.cancelRequested = true
      activeRun.terminalStatus = 'aborted'

      const deps = createDeps()

      await executeRun(
        activeRun,
        { message: { id: 'msg-1', role: 'user', parts: [] }, profile: null },
        deps,
      )

      // The cancel flow already finalized this run: the pump must not
      // re-publish a terminal chunk on top of it.
      expect(deps.publishTerminalChunk).not.toHaveBeenCalled()

      expect(deps.finalizeSnapshot).toHaveBeenCalledTimes(1)
      const [, finalChunk] = (deps.finalizeSnapshot as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(finalChunk).toEqual({ type: 'abort', reason: 'user' })
    })
  })

  it('finalizes normally with an error chunk when the runtime genuinely produces no output', async () => {
    await withTempDataDir(async () => {
      const sessionId = `session-${randomUUID()}`
      const runId = `run-${randomUUID()}`

      const runtime = createStreamingRuntime([])
      const activeRun = createActiveRun({ runId, sessionId, runtime })

      const deps = createDeps()

      await executeRun(
        activeRun,
        { message: { id: 'msg-1', role: 'user', parts: [] }, profile: null },
        deps,
      )

      expect(deps.publishTerminalChunk).toHaveBeenCalledTimes(1)
      const [, finalChunk] = (deps.finalizeSnapshot as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(finalChunk).toMatchObject({ type: 'error' })
    })
  })

  it('releases the active run and drains the queue when completion throws', async () => {
    await withTempDataDir(async () => {
      const sessionId = `session-${randomUUID()}`
      const runId = `run-${randomUUID()}`
      const runtime = createStreamingRuntime([{ type: 'finish', finishReason: 'stop' }])
      const activeRun = createActiveRun({ runId, sessionId, runtime })
      const failure = new Error('snapshot finalization failed')
      const deps = createDeps({
        finalizeSnapshot: vi.fn(() => {
          throw failure
        }),
      })

      await expect(executeRun(
        activeRun,
        { message: { id: 'msg-1', role: 'user', parts: [] }, profile: null },
        deps,
      )).rejects.toThrow(failure)

      expect(deps.releaseActiveRun).toHaveBeenCalledTimes(1)
      expect(deps.releaseActiveRun).toHaveBeenCalledWith(activeRun)
      expect(deps.scheduleQueueDrain).toHaveBeenCalledTimes(1)
      expect(deps.scheduleQueueDrain).toHaveBeenCalledWith(sessionId)
    })
  })
})
