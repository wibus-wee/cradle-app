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

  it('projects admission, worked, and total time from durable snapshot facts', () => {
    const snapshot = buildSnapshot({
      completedAt: 9_000,
      events: [
        buildEvent({ seq: 0, phase: 'run_admission_requested', occurredAt: 900 }),
        buildEvent({ seq: 1, phase: 'run_started', occurredAt: 1_000 }),
        buildEvent({ seq: 2, phase: 'model_stream_started', chunkType: 'start', occurredAt: 1_300 }),
        buildEvent({ seq: 3, phase: 'model_first_token_delta', chunkType: 'reasoning-delta', occurredAt: 1_600 }),
        buildEvent({ seq: 4, phase: 'model_reasoning_completed', chunkType: 'reasoning-end', occurredAt: 4_000 }),
        buildEvent({ seq: 5, phase: 'tool_call_started', chunkType: 'tool-input-start', occurredAt: 4_200 }),
        buildEvent({ seq: 6, phase: 'tool_call_output_available', chunkType: 'tool-output-available', occurredAt: 6_000 }),
        buildEvent({ seq: 7, phase: 'model_text_started', chunkType: 'text-start', occurredAt: 6_300 }),
        buildEvent({ seq: 8, phase: 'model_text_delta', chunkType: 'text-delta', occurredAt: 8_500 }),
      ],
    })

    expect(readRunSnapshotTimings(snapshot)).toEqual({
      acceptMs: 100,
      ttfbMs: 300,
      ttftMs: 600,
      workedMs: 4_700,
      totalMs: 8_000,
    })
  })

  it('uses the final text start after the last execution activity', () => {
    const snapshot = buildSnapshot({
      events: [
        buildEvent({ seq: 0, phase: 'model_first_token_delta', chunkType: 'reasoning-delta', occurredAt: 1_200 }),
        buildEvent({ seq: 1, phase: 'model_text_started', chunkType: 'text-start', occurredAt: 2_000 }),
        buildEvent({ seq: 2, phase: 'tool_call_started', chunkType: 'tool-input-start', occurredAt: 2_500 }),
        buildEvent({ seq: 3, phase: 'tool_call_output_available', chunkType: 'tool-output-available', occurredAt: 3_000 }),
        buildEvent({ seq: 4, phase: 'model_text_started', chunkType: 'text-start', occurredAt: 3_400 }),
      ],
    })

    expect(readRunSnapshotTimings(snapshot).workedMs).toBe(2_200)
  })

  it('does not infer Worked from a truncated event window', () => {
    const snapshot = buildSnapshot({
      eventsTruncated: true,
      events: [
        buildEvent({ seq: 0, phase: 'model_first_token_delta', chunkType: 'reasoning-delta', occurredAt: 1_200 }),
        buildEvent({ seq: 1, phase: 'model_reasoning_completed', chunkType: 'reasoning-end', occurredAt: 2_000 }),
        buildEvent({ seq: 2, phase: 'model_text_started', chunkType: 'text-start', occurredAt: 2_500 }),
      ],
    })

    expect(readRunSnapshotTimings(snapshot).workedMs).toBeNull()
  })
})

function buildSnapshot(input: {
  events: GetChatRunsByRunIdSnapshotResponse['events']
  completedAt?: number | null
  eventsTruncated?: boolean
}): GetChatRunsByRunIdSnapshotResponse {
  return {
    id: 'snapshot-1',
    schemaVersion: 1,
    traceId: 'trace-1',
    chatSessionId: 'session-1',
    runId: 'run-1',
    status: 'running',
    startedAt: 1_000,
    completedAt: input.completedAt ?? null,
    summary: {},
    events: input.events,
    eventCount: input.events.length,
    eventsTruncated: input.eventsTruncated ?? false,
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
