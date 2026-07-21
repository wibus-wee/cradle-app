import { describe, expect, it, vi } from 'vitest'

import type { ActiveRun } from '../run-registry'
import { createActiveRunChunkLog } from '../stream/run-chunk-log'
import { createFinalMessageProjectionState } from './final-message-projection'

const { commitSessionEventsWithProjection, readRunWriteFence } = vi.hoisted(() => ({
  commitSessionEventsWithProjection: vi.fn(),
  readRunWriteFence: vi.fn(() => ({ status: 'streaming' as const })),
}))

vi.mock('../es/commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('../es/commands')>()
  return { ...original, commitSessionEventsWithProjection }
})

vi.mock('./run-write-fence', async (importOriginal) => {
  const original = await importOriginal<typeof import('./run-write-fence')>()
  return { ...original, readRunWriteFence }
})

const { createTerminalRunFinalizer } = await import('./terminal-finalizer')

function activeRun(): ActiveRun {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    messageId: 'assistant-1',
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
    runChunkLog: createActiveRunChunkLog('run-1'),
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
  it('rejects and leaves the live run non-terminal when durable terminal persistence fails', async () => {
    commitSessionEventsWithProjection.mockRejectedValueOnce(new Error('terminal write failed'))
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
})
