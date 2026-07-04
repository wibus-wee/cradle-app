import { describe, expect, it } from 'vitest'

import type { GetChatRunsByRunIdSnapshotResponse } from '~/api-gen/types.gen'

import { readRunSnapshotTimings } from './run-debug-timings'

describe('readRunSnapshotTimings', () => {
  it('counts reasoning deltas as first token time', () => {
    const snapshot = buildSnapshot({
      events: [
        buildEvent({ seq: 0, phase: 'run_started', occurredAt: 1_000 }),
        buildEvent({ seq: 1, phase: 'model_reasoning_started', chunkType: 'reasoning-start', occurredAt: 1_500 }),
        buildEvent({ seq: 2, phase: 'model_first_token_delta', chunkType: 'reasoning-delta', occurredAt: 1_620 }),
        buildEvent({ seq: 3, phase: 'model_text_first_delta', chunkType: 'text-delta', occurredAt: 2_400 }),
      ],
    })

    expect(readRunSnapshotTimings(snapshot)).toMatchObject({
      ttfbMs: 500,
      ttftMs: 620,
    })
  })

  it('falls back to legacy first text delta snapshots', () => {
    const snapshot = buildSnapshot({
      events: [
        buildEvent({ seq: 0, phase: 'model_stream_started', chunkType: 'start', occurredAt: 1_100 }),
        buildEvent({ seq: 1, phase: 'model_text_first_delta', chunkType: 'text-delta', occurredAt: 1_700 }),
      ],
    })

    expect(readRunSnapshotTimings(snapshot)).toMatchObject({
      ttfbMs: 100,
      ttftMs: 700,
    })
  })
})

function buildSnapshot(input: {
  events: GetChatRunsByRunIdSnapshotResponse['events']
}): GetChatRunsByRunIdSnapshotResponse {
  return {
    id: 'snapshot-1',
    schemaVersion: 1,
    traceId: 'trace-1',
    chatSessionId: 'session-1',
    runId: 'run-1',
    status: 'running',
    startedAt: 1_000,
    completedAt: null,
    summary: {},
    events: input.events,
    runtimeKind: 'test',
  }
}

function buildEvent(input: {
  seq: number
  phase: string
  occurredAt: number
  chunkType?: string
}): GetChatRunsByRunIdSnapshotResponse['events'][number] {
  return {
    id: `event-${input.seq}`,
    snapshotId: 'snapshot-1',
    chatSessionId: 'session-1',
    runId: 'run-1',
    seq: input.seq,
    phase: input.phase,
    chunkType: input.chunkType,
    occurredAt: input.occurredAt,
    payload: {},
  }
}
