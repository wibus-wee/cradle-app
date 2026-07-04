import type { GetChatRunsByRunIdSnapshotResponse } from '~/api-gen/types.gen'
import type { ChatRunDisplayMeta } from '~/store/chat'

export type RunTimingMetrics = {
  acceptMs: number | null
  ttfbMs: number | null
  ttftMs: number | null
  totalMs: number | null
}

type RunSnapshotEvent = GetChatRunsByRunIdSnapshotResponse['events'][number]

const TERMINAL_CHUNK_TYPES = new Set(['finish', 'abort', 'error'])
const NON_RESPONSE_SNAPSHOT_PHASES = new Set([
  'run_started',
  'stream_finished',
  'stream_failed',
  'run_finalized',
  'usage',
  'step_usage',
])
const TOKEN_DELTA_SNAPSHOT_PHASES = new Set([
  'model_first_token_delta',
  'model_text_first_delta',
  'model_text_delta',
  'model_reasoning_delta',
  'tool_call_input_delta',
])

export function readLocalRunTimings(meta: ChatRunDisplayMeta): RunTimingMetrics {
  return {
    acceptMs: meta.acceptedAtMs === null ? null : Math.max(0, meta.acceptedAtMs - meta.requestStartedAtMs),
    ttfbMs: meta.firstEventAtMs === null ? null : Math.max(0, meta.firstEventAtMs - meta.requestStartedAtMs),
    ttftMs: meta.firstContentAtMs === null ? null : Math.max(0, meta.firstContentAtMs - meta.requestStartedAtMs),
    totalMs: meta.completedAtMs === null ? null : Math.max(0, meta.completedAtMs - meta.requestStartedAtMs),
  }
}

export function readRunSnapshotTimings(snapshot: GetChatRunsByRunIdSnapshotResponse): RunTimingMetrics {
  const firstResponseEvent = snapshot.events.find(isResponseSnapshotEvent)
  const firstTokenDeltaEvent = snapshot.events.find(isTokenDeltaSnapshotEvent)
  return {
    acceptMs: null,
    ttfbMs: firstResponseEvent ? Math.max(0, firstResponseEvent.occurredAt - snapshot.startedAt) : null,
    ttftMs: firstTokenDeltaEvent ? Math.max(0, firstTokenDeltaEvent.occurredAt - snapshot.startedAt) : null,
    totalMs: snapshot.completedAt == null ? null : Math.max(0, snapshot.completedAt - snapshot.startedAt),
  }
}

function isResponseSnapshotEvent(event: RunSnapshotEvent): boolean {
  return Boolean(
    event.chunkType
    && !TERMINAL_CHUNK_TYPES.has(event.chunkType)
    && !NON_RESPONSE_SNAPSHOT_PHASES.has(event.phase),
  )
}

function isTokenDeltaSnapshotEvent(event: RunSnapshotEvent): boolean {
  return TOKEN_DELTA_SNAPSHOT_PHASES.has(event.phase)
}
