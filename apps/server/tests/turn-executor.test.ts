import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendRuns, sessions, usageLogs } from '@cradle/db'
import type { UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../src/infra'
import { createFinalMessageProjectionState } from '../src/modules/chat-runtime/run/final-message-projection'
import type { ActiveTurnOutcome } from '../src/modules/chat-runtime/run/turn-completion'
import type { TurnExecutorDeps } from '../src/modules/chat-runtime/run/turn-executor'
import { executeRun } from '../src/modules/chat-runtime/run/turn-executor'
import type { ActiveRun } from '../src/modules/chat-runtime/run-registry'
import type { ChatRuntime } from '../src/modules/chat-runtime/runtime-provider-types'
import { createRunChunkLog } from '../src/modules/chat-runtime/stream/run-chunk-log'
import { insertMessageFixtures } from './helpers/message-fixture'

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
    runChunkLog: createRunChunkLog(input.runId, 100),
    pendingDeltaChunk: null,
    pendingDeltaFlushTimer: null,
    snapshotTimer: null,
    finalMessage: { id: `${input.runId}-message`, role: 'assistant', parts: [] },
    finalProjection: createFinalMessageProjectionState(),
    runtimeSettings: {} as ActiveRun['runtimeSettings'],
    usageEventCount: 0,
    usageEventAggregate: null,
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
    completeActiveTurn: vi.fn(async (run: ActiveRun, outcome: ActiveTurnOutcome) => {
      run.terminalStatus
        = outcome.terminalChunk.type === 'finish'
          ? 'complete'
          : outcome.terminalChunk.type === 'abort'
            ? 'aborted'
            : 'failed'
      await outcome.requiredBookkeeping?.(outcome.terminalChunk)
      try {
        await outcome.bestEffortBookkeeping?.(outcome.terminalChunk)
      }
      catch (error) {
        // Mirror production: best-effort failures are observed, not fatal.
        void error
      }
      return { durableTerminal: true, terminalChunk: outcome.terminalChunk }
    }),
    recordSnapshotEvent: vi.fn(),
    finalizeSnapshot: vi.fn(),
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

describe('executeRun provider usage events', () => {
  it('persists every provider call without a run-final fallback row', async () => {
    await withTempDataDir(async () => {
      const sessionId = `session-${randomUUID()}`
      const runId = `run-${randomUUID()}`
      db().insert(sessions).values({ id: sessionId, title: 'Session', runtimeKind: 'codex' }).run()
      insertMessageFixtures(db(), {
        id: `${runId}-message`,
        sessionId,
        role: 'assistant',
        content: '',
        messageJson: JSON.stringify({ id: `${runId}-message`, role: 'assistant', parts: [] }),
      })
      const runtime = {
        ...createStreamingRuntime([]),
        runtimeKind: 'codex',
        usageAccounting: 'provider-events',
        lastUsage: { promptTokens: 999, completionTokens: 1, totalTokens: 1_000 },
        async* streamTurn(input) {
          await input.onUsageEvent?.({
            id: 'usage-event-1',
            providerThreadId: 'root-thread',
            providerTurnId: 'turn-1',
            modelId: 'gpt-5.6-sol',
            occurredAt: 1_789_000_000,
            usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
            providerTotal: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
          })
          await input.onUsageEvent?.({
            id: 'usage-event-2',
            providerThreadId: 'child-thread',
            providerTurnId: 'child-turn',
            modelId: 'gpt-5.6-sol',
            occurredAt: 1_789_000_001,
            usage: { promptTokens: 200, completionTokens: 20, totalTokens: 220 },
            providerTotal: { promptTokens: 200, completionTokens: 20, totalTokens: 220 },
          })
          yield { type: 'text-delta', id: 'text-1', delta: 'done' }
          yield { type: 'finish', finishReason: 'stop' }
        },
      } as ChatRuntime
      const activeRun = createActiveRun({ runId, sessionId, runtime })
      activeRun.runtimeSession.runtimeKind = 'codex'
      activeRun.runtimeSession.providerSessionId = 'root-thread'
      const deps = createDeps()

      await executeRun(
        activeRun,
        { message: { id: 'msg-1', role: 'user', parts: [] }, profile: null },
        deps,
      )

      expect(activeRun.usageEventAggregate).toEqual(expect.objectContaining({
        promptTokens: 300,
        completionTokens: 30,
        totalTokens: 330,
      }))
      expect(db().select().from(usageLogs).all()).toEqual([
        expect.objectContaining({ id: 'usage-event-1', runId, sessionId, providerThreadId: 'root-thread' }),
        expect.objectContaining({ id: 'usage-event-2', runId, sessionId, providerThreadId: 'child-thread' }),
      ])
      expect(activeRun.usageEventCount).toBe(2)
    })
  })

  it('does not fail generation when provider usage arrives before its session identity', async () => {
    await withTempDataDir(async () => {
      const sessionId = `session-${randomUUID()}`
      const runId = `run-${randomUUID()}`
      db().insert(sessions).values({ id: sessionId, title: 'Session', runtimeKind: 'codex' }).run()
      insertMessageFixtures(db(), {
        id: `${runId}-message`,
        sessionId,
        role: 'assistant',
        content: '',
        messageJson: JSON.stringify({ id: `${runId}-message`, role: 'assistant', parts: [] }),
      })
      db().insert(backendRuns).values({
        id: runId,
        bindingId: null,
        chatSessionId: sessionId,
        messageId: `${runId}-message`,
        origin: 'user',
        status: 'streaming',
        stopReason: null,
        errorText: null,
        startedAt: 1_789_000_000,
        finishedAt: null,
      }).run()
      const runtime = {
        ...createStreamingRuntime([]),
        runtimeKind: 'codex',
        usageAccounting: 'provider-events',
        async* streamTurn(input) {
          await input.onUsageEvent?.({
            id: 'usage-event-1',
            providerThreadId: 'root-thread',
            providerTurnId: 'turn-1',
            modelId: 'gpt-5.6-sol',
            occurredAt: 1_789_000_000,
            usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
            providerTotal: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
          })
          yield { type: 'text-delta', id: 'text-1', delta: 'done' }
          yield { type: 'finish', finishReason: 'stop' }
        },
      } as ChatRuntime
      const activeRun = createActiveRun({ runId, sessionId, runtime })
      const deps = createDeps()

      await executeRun(
        activeRun,
        { message: { id: 'msg-1', role: 'user', parts: [] }, profile: null },
        deps,
      )

      expect(deps.completeActiveTurn).toHaveBeenCalledOnce()
      expect(activeRun.usageEventCount).toBe(0)
      const [, finalChunk] = (deps.finalizeSnapshot as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(finalChunk).toEqual({ type: 'finish', finishReason: 'stop' })
    })
  })
})

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

      expect(deps.completeActiveTurn).toHaveBeenCalledTimes(1)
      const [, outcome] = (deps.completeActiveTurn as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(outcome.terminalChunk).toEqual({ type: 'abort', reason: 'user' })
      expect(deps.finalizeSnapshot).not.toHaveBeenCalled()
    })
  })

  it('finalizes normally when the runtime produces no output', async () => {
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

      expect(deps.completeActiveTurn).toHaveBeenCalledTimes(1)
      const [, finalChunk] = (deps.finalizeSnapshot as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(finalChunk).toMatchObject({ type: 'finish', finishReason: 'stop' })
    })
  })

  it('keeps the turn successful when forensic snapshot finalization fails after durable terminal', async () => {
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

      await executeRun(
        activeRun,
        { message: { id: 'msg-1', role: 'user', parts: [] }, profile: null },
        deps,
      )

      expect(deps.completeActiveTurn).toHaveBeenCalledTimes(1)
      expect(deps.finalizeSnapshot).toHaveBeenCalledTimes(1)
      expect(deps.warn).toHaveBeenCalledWith(
        'failed to finalize run snapshot after durable terminal',
        expect.objectContaining({
          error: failure,
          sessionId,
          runId,
        }),
      )
    })
  })
})
