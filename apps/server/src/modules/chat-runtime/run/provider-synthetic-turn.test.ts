import type { BackendRun } from '@cradle/db'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ActiveRun } from '../run-registry'
import { runRegistry } from '../run-registry'
import { createActiveRunChunkLog } from '../stream/run-chunk-log'
import { createFinalMessageProjectionState } from './final-message-projection'

const startRun = vi.fn()
const waitForRunCompletion = vi.fn().mockResolvedValue(undefined)

vi.mock('./turn-draft', () => ({ startRun }))
vi.mock('../stream/live-run-streams', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stream/live-run-streams')>()
  return { ...original, waitForRunCompletion }
})

const { createProviderSyntheticTurnEventHandler } = await import('./provider-synthetic-turn')

function parentRun(): ActiveRun {
  return {
    runId: 'parent-run',
    sessionId: 'session-1',
    messageId: 'parent-message',
    providerTargetKind: null,
    providerTargetId: null,
    runtime: {} as ActiveRun['runtime'],
    runtimeSession: {
      id: 'runtime-session-1',
      chatSessionId: 'session-1',
      providerTargetId: null,
      runtimeKind: 'claude-agent',
      providerSessionId: 'provider-session-1',
      providerStateSnapshot: null,
    },
    modelId: 'model-1',
    runChunkLog: createActiveRunChunkLog('parent-run'),
    pendingDeltaChunk: null,
    pendingDeltaFlushTimer: null,
    snapshotTimer: null,
    finalMessage: { id: 'parent-message', role: 'assistant', parts: [] },
    finalProjection: createFinalMessageProjectionState(),
    runtimeSettings: {} as ActiveRun['runtimeSettings'],
    usageEventCount: 0,
    usageEventAggregate: null,
    runSnapshotSeq: 0,
    snapshotEventIdByCoalesceKey: new Map(),
    runSnapshotDroppedEventCount: 0,
  }
}

afterEach(() => {
  runRegistry.clearAll()
  vi.clearAllMocks()
})

describe('provider synthetic turn inbox', () => {
  it('serializes 100 concurrent deliveries for one provider turn into one durable run', async () => {
    startRun.mockImplementation(async (input: { messageId: string }) => ({
      id: 'synthetic-run',
      bindingId: null,
      chatSessionId: 'session-1',
      messageId: input.messageId,
      origin: 'system',
      status: 'streaming',
      stopReason: null,
      errorText: null,
      startedAt: 1,
      finishedAt: null,
    } satisfies BackendRun))
    const published: UIMessageChunk[] = []
    const completeActiveTurn = vi.fn(async (run: ActiveRun) => {
      run.terminalStatus = 'complete'
      return { durableTerminal: true }
    })
    const handler = createProviderSyntheticTurnEventHandler(parentRun(), {
      stream: {
        publishRunStartChunk: vi.fn(),
        publishRuntimeChunk: (_run, chunk) => published.push(chunk),
      },
      completeActiveTurn,
    })

    const deliveries = Array.from({ length: 100 }, (_, index) => handler({
      providerThreadId: null,
      providerTurnId: 'provider-turn-1',
      chunks: [{ type: 'text-delta', id: 'text-1', delta: String(index) }],
    }))
    deliveries.push(handler({
      providerThreadId: null,
      providerTurnId: 'provider-turn-1',
      chunks: [{ type: 'finish', finishReason: 'stop' }],
    }))

    await Promise.all(deliveries)

    expect(startRun).toHaveBeenCalledTimes(1)
    expect(published.map(chunk => chunk.type === 'text-delta' ? chunk.delta : chunk.type)).toEqual(
      Array.from({ length: 100 }, (_, index) => String(index)),
    )
    expect(completeActiveTurn).toHaveBeenCalledTimes(1)
  })
})
