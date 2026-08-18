import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { createFinalMessageProjectionState } from '../run/final-message-projection'
import type { ActiveRun } from '../run-registry'
import { createActiveRunStreamController } from './active-run-stream'
import { createRunChunkSequencer } from './run-chunk-sequencer'

function createActiveRun(): ActiveRun {
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

describe('active run stream client boundary', () => {
  it('keeps provider reconstruction metadata in the final message but not published chunks', () => {
    const activeRun = createActiveRun()
    const publishedChunks: UIMessageChunk[] = []
    activeRun.runChunkSequencer.subscribe(entry => publishedChunks.push(entry.chunk))
    const stream = createActiveRunStreamController({
      handleStaleActiveRun: () => {},
      error: () => {},
    })
    const chunk: UIMessageChunk = {
      type: 'message-metadata',
      messageMetadata: {
        codex: {
          responseItems: [{ turnId: 'turn-1', item: { type: 'message' } }],
          model: 'gpt-5',
        },
        cradle: { updated: true },
      },
    }

    stream.publishUIMessageChunk(activeRun, chunk, false)

    expect(activeRun.finalMessage.metadata).toEqual({
      codex: {
        responseItems: [{ turnId: 'turn-1', item: { type: 'message' } }],
        model: 'gpt-5',
      },
      cradle: { updated: true },
    })
    expect(publishedChunks).toEqual([{
      type: 'message-metadata',
      messageMetadata: {
        codex: { model: 'gpt-5' },
        cradle: { updated: true },
      },
    }])
  })
})
