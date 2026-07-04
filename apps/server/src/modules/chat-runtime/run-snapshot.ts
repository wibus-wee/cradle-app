// Chat Runtime-owned durable run snapshot recorder for runtime-neutral harness inspection.
import { randomUUID } from 'node:crypto'

import type {
  BackendRunSnapshot,
  BackendRunSnapshotEvent,
  NewBackendRunSnapshot,
  NewBackendRunSnapshotEvent,
} from '@cradle/db'
import { backendRunSnapshotEvents, backendRunSnapshots } from '@cradle/db'
import type { SQL } from 'drizzle-orm'
import { and, asc, desc, eq, gte, lt, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

import { readNonNegativeIntegerEnv, readPositiveIntegerEnv } from '../../helpers/env'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { OBSERVABILITY_CODES } from '../observability/contract'
import * as Observability from '../observability/service'

const logger = createChildLogger({ module: 'chat-runtime.run-snapshot' })

export type RunSnapshotStatus = 'running' | 'complete' | 'failed' | 'aborted'

export interface ChatRunSnapshot {
  id: string
  schemaVersion: number
  traceId: string
  chatSessionId: string | null
  runId: string | null
  messageId?: string
  providerTargetId?: string
  runtimeKind: string
  providerSessionId?: string
  modelId?: string
  agentId?: string
  workspaceId?: string
  status: RunSnapshotStatus
  startedAt: number
  completedAt: number | null
  completionReason?: string
  errorText?: string
  summary: Record<string, unknown>
  events: ChatRunSnapshotEvent[]
  /** Total number of durable event rows recorded for this snapshot (independent of how many `events` were hydrated). */
  eventCount: number
  /** True when `events` was cut off by the read-side limit and does not contain every row. */
  eventsTruncated: boolean
}

export interface ChatRunSnapshotEvent {
  id: string
  snapshotId: string
  chatSessionId: string | null
  runId: string | null
  seq: number
  phase: string
  chunkType?: string
  toolCallId?: string
  toolName?: string
  modelId?: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  estimatedCostUsd?: number
  occurredAt: number
  durationMs?: number
  payload: Record<string, unknown>
}

export interface StartRunSnapshotInput {
  id?: string
  traceId?: string
  chatSessionId: string
  runId: string
  messageId?: string | null
  providerTargetId?: string | null
  runtimeKind: string
  providerSessionId?: string | null
  modelId?: string | null
  agentId?: string | null
  workspaceId?: string | null
  startedAt?: number
  summary?: Record<string, unknown>
}

export interface AppendRunSnapshotEventInput {
  snapshotId: string
  chatSessionId: string
  runId: string
  seq: number
  phase: string
  chunkType?: string | null
  toolCallId?: string | null
  toolName?: string | null
  modelId?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
  estimatedCostUsd?: number | null
  occurredAt?: number
  durationMs?: number | null
  payload?: Record<string, unknown>
}

export interface UpdateRunSnapshotEventPayloadInput {
  eventId: string
  payload: Record<string, unknown>
  occurredAt?: number
  durationMs?: number | null
}

export interface FinalizeRunSnapshotInput {
  snapshotId: string
  status: RunSnapshotStatus
  completedAt?: number
  completionReason?: string | null
  errorText?: string | null
  modelId?: string | null
  providerSessionId?: string | null
  summary?: Record<string, unknown>
}

export interface RunSnapshotFilter {
  chatSessionId?: string
  runId?: string
  traceId?: string
  since?: number
  limit?: number
  /**
   * Hydrate each snapshot's full `events` array. Defaults to false: listing
   * snapshots should stay a cheap summary read, not N full event-log reads.
   */
  includeEvents?: boolean
}

const SCHEMA_VERSION = 1
const DEFAULT_PAYLOAD_LIMIT = 64_000
const DEFAULT_RETENTION_DAYS = 30
const RETENTION_PRUNE_INTERVAL_MS = 60 * 60 * 1000
const DEFAULT_SNAPSHOT_EVENTS_READ_LIMIT = 2_000
const DEFAULT_SNAPSHOT_EVENTS_MAX = 2_000

/**
 * Hard cap on how many event rows a single run snapshot may accumulate.
 * Defense against upstream chunk storms (e.g. a runtime re-pushing the same
 * tool output thousands of times) that would otherwise write unbounded rows
 * even after coalescing known-repeatable chunk types.
 */
export function readMaxRunSnapshotEvents(): number {
  return readPositiveIntegerEnv('CRADLE_CHAT_RUN_SNAPSHOT_MAX_EVENTS', DEFAULT_SNAPSHOT_EVENTS_MAX)
}

function readRunSnapshotEventsReadLimit(): number {
  return readPositiveIntegerEnv('CRADLE_CHAT_RUN_SNAPSHOT_EVENTS_READ_LIMIT', DEFAULT_SNAPSHOT_EVENTS_READ_LIMIT)
}
const SnapshotRecordSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.record(z.string(), z.unknown()))
let lastRetentionPruneAt = 0

export function startRunSnapshot(input: StartRunSnapshotInput): ChatRunSnapshot | null {
  const id = input.id ?? randomUUID()
  const row: NewBackendRunSnapshot = {
    id,
    schemaVersion: SCHEMA_VERSION,
    traceId: input.traceId ?? input.runId,
    chatSessionId: input.chatSessionId,
    runId: input.runId,
    messageId: input.messageId ?? null,
    providerTargetId: input.providerTargetId ?? null,
    runtimeKind: input.runtimeKind,
    providerSessionId: input.providerSessionId ?? null,
    modelId: input.modelId ?? null,
    agentId: input.agentId ?? null,
    workspaceId: input.workspaceId ?? null,
    status: 'running',
    startedAt: input.startedAt ?? Date.now(),
    completedAt: null,
    completionReason: null,
    errorText: null,
    summaryJson: stringifySnapshotRecord(input.summary ?? {}),
  }

  try {
    pruneExpiredRunSnapshots()
    db().insert(backendRunSnapshots).values(row).run()
    return toChatRunSnapshot(row as BackendRunSnapshot, [])
  }
  catch (error) {
    logger.error('failed to start run snapshot', { input, error })
    return null
  }
}

export function appendRunSnapshotEvent(input: AppendRunSnapshotEventInput): ChatRunSnapshotEvent | null {
  const row: NewBackendRunSnapshotEvent = {
    id: randomUUID(),
    snapshotId: input.snapshotId,
    chatSessionId: input.chatSessionId,
    runId: input.runId,
    seq: input.seq,
    phase: input.phase,
    chunkType: input.chunkType ?? null,
    toolCallId: input.toolCallId ?? null,
    toolName: input.toolName ?? null,
    modelId: input.modelId ?? null,
    promptTokens: input.promptTokens ?? null,
    completionTokens: input.completionTokens ?? null,
    totalTokens: input.totalTokens ?? null,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    occurredAt: input.occurredAt ?? Date.now(),
    durationMs: input.durationMs ?? null,
    payloadJson: stringifySnapshotRecord(input.payload ?? {}),
  }

  try {
    db().insert(backendRunSnapshotEvents).values(row).run()
    return toChatRunSnapshotEvent(row as BackendRunSnapshotEvent)
  }
  catch (error) {
    logger.error('failed to append run snapshot event', { input, error })
    return null
  }
}

/**
 * Update an existing snapshot event row in place instead of appending a new
 * row. Used to coalesce repeated chunks for the same logical event (see
 * `readReplayCoalesceKey`) so a misbehaving runtime that re-pushes the same
 * tool output thousands of times produces one durable row, not thousands.
 */
export function updateRunSnapshotEventPayload(input: UpdateRunSnapshotEventPayloadInput): void {
  try {
    db()
      .update(backendRunSnapshotEvents)
      .set({
        payloadJson: stringifySnapshotRecord(input.payload),
        occurredAt: input.occurredAt ?? Date.now(),
        durationMs: input.durationMs ?? null,
      })
      .where(eq(backendRunSnapshotEvents.id, input.eventId))
      .run()
  }
  catch (error) {
    logger.error('failed to update run snapshot event payload', { input, error })
  }
}

export function finalizeRunSnapshot(input: FinalizeRunSnapshotInput): void {
  const values: Partial<NewBackendRunSnapshot> = {
    status: input.status,
    completedAt: input.completedAt ?? Date.now(),
    completionReason: input.completionReason ?? null,
    errorText: input.errorText ?? null,
  }
  if (input.modelId !== undefined) {
    values.modelId = input.modelId
  }
  if (input.providerSessionId !== undefined) {
    values.providerSessionId = input.providerSessionId
  }
  if (input.summary) {
    values.summaryJson = stringifySnapshotRecord(input.summary)
  }

  try {
    const previous = db()
      .select()
      .from(backendRunSnapshots)
      .where(eq(backendRunSnapshots.id, input.snapshotId))
      .get()
    const result = db()
      .update(backendRunSnapshots)
      .set(values)
      .where(
        and(eq(backendRunSnapshots.id, input.snapshotId), eq(backendRunSnapshots.status, 'running')),
      )
      .run()
    if (result.changes === 0 && previous && previous.status !== 'running') {
      Observability.record({
        source: 'chat-engine',
        code: OBSERVABILITY_CODES.chatLateRunFinalizationIgnored,
        severity: 'warn',
        category: 'chat',
        message: 'Ignored late run snapshot finalization because the snapshot is already terminal.',
        chatSessionId: previous.chatSessionId ?? undefined,
        runId: previous.runId ?? undefined,
        messageId: previous.messageId ?? undefined,
        attrs: {
          snapshotId: input.snapshotId,
          previousStatus: previous.status,
          attemptedStatus: input.status,
          providerTargetId: previous.providerTargetId,
        },
      })
    }
  }
  catch (error) {
    logger.error('failed to finalize run snapshot', { input, error })
  }
}

export function getRunSnapshots(filter: RunSnapshotFilter = {}): ChatRunSnapshot[] {
  const conditions: SQL[] = []
  if (filter.chatSessionId) {
    conditions.push(eq(backendRunSnapshots.chatSessionId, filter.chatSessionId))
  }
  if (filter.runId) {
    conditions.push(eq(backendRunSnapshots.runId, filter.runId))
  }
  if (filter.traceId) {
    conditions.push(eq(backendRunSnapshots.traceId, filter.traceId))
  }
  if (filter.since !== undefined) {
    conditions.push(gte(backendRunSnapshots.startedAt, filter.since))
  }

  const limit = clampSnapshotLimit(filter.limit)
  const rows = conditions.length > 0
    ? db()
        .select()
        .from(backendRunSnapshots)
        .where(and(...conditions))
        .orderBy(desc(backendRunSnapshots.startedAt))
        .limit(limit)
        .all()
    : db()
        .select()
        .from(backendRunSnapshots)
        .orderBy(desc(backendRunSnapshots.startedAt))
        .limit(limit)
        .all()

  return rows.map(row => toChatRunSnapshot(row, filter.includeEvents ? getSnapshotEvents(row.id) : []))
}

export function getRunSnapshot(runId: string): ChatRunSnapshot | null {
  const row = db()
    .select()
    .from(backendRunSnapshots)
    .where(eq(backendRunSnapshots.runId, runId))
    .get()
  return row ? toChatRunSnapshot(row, getSnapshotEvents(row.id)) : null
}

/**
 * Read snapshot event rows ordered by `seq`, bounded at the SQL layer so a
 * snapshot with a pathological number of rows can't be pulled fully into
 * memory just to render a debug view. Pair with `countSnapshotEvents` to
 * detect truncation.
 */
function getSnapshotEvents(snapshotId: string, limit = readRunSnapshotEventsReadLimit()): BackendRunSnapshotEvent[] {
  return db()
    .select()
    .from(backendRunSnapshotEvents)
    .where(eq(backendRunSnapshotEvents.snapshotId, snapshotId))
    .orderBy(asc(backendRunSnapshotEvents.seq))
    .limit(limit)
    .all()
}

function countSnapshotEvents(snapshotId: string): number {
  return db()
    .select({ count: sql<number>`count(*)` })
    .from(backendRunSnapshotEvents)
    .where(eq(backendRunSnapshotEvents.snapshotId, snapshotId))
    .get()
?.count ?? 0
}

function toChatRunSnapshot(row: BackendRunSnapshot, events: BackendRunSnapshotEvent[]): ChatRunSnapshot {
  const eventCount = countSnapshotEvents(row.id)
  return {
    id: row.id,
    schemaVersion: row.schemaVersion,
    traceId: row.traceId,
    chatSessionId: row.chatSessionId,
    runId: row.runId,
    messageId: row.messageId ?? undefined,
    providerTargetId: row.providerTargetId ?? undefined,
    runtimeKind: row.runtimeKind,
    providerSessionId: row.providerSessionId ?? undefined,
    modelId: row.modelId ?? undefined,
    agentId: row.agentId ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    status: row.status as RunSnapshotStatus,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    completionReason: row.completionReason ?? undefined,
    errorText: row.errorText ?? undefined,
    summary: SnapshotRecordSchema.parse(row.summaryJson),
    events: events.map(toChatRunSnapshotEvent),
    eventCount,
    eventsTruncated: events.length < eventCount,
  }
}

function toChatRunSnapshotEvent(row: BackendRunSnapshotEvent): ChatRunSnapshotEvent {
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    chatSessionId: row.chatSessionId,
    runId: row.runId,
    seq: row.seq,
    phase: row.phase,
    chunkType: row.chunkType ?? undefined,
    toolCallId: row.toolCallId ?? undefined,
    toolName: row.toolName ?? undefined,
    modelId: row.modelId ?? undefined,
    promptTokens: row.promptTokens ?? undefined,
    completionTokens: row.completionTokens ?? undefined,
    totalTokens: row.totalTokens ?? undefined,
    estimatedCostUsd: row.estimatedCostUsd ?? undefined,
    occurredAt: row.occurredAt,
    durationMs: row.durationMs ?? undefined,
    payload: SnapshotRecordSchema.parse(row.payloadJson),
  }
}

function stringifySnapshotRecord(payload: Record<string, unknown>): string {
  const raw = JSON.stringify(payload)
  const limit = readPositiveIntegerEnv('CRADLE_CHAT_RUN_SNAPSHOT_PAYLOAD_MAX_CHARS', DEFAULT_PAYLOAD_LIMIT)
  if (raw.length <= limit) {
    return raw
  }
  return JSON.stringify({
    schema: 'cradle.truncated-json-preview.v1',
    originalLength: raw.length,
    preview: raw.slice(0, limit),
  })
}

function pruneExpiredRunSnapshots(): void {
  const now = Date.now()
  if (now - lastRetentionPruneAt < RETENTION_PRUNE_INTERVAL_MS) {
    return
  }
  lastRetentionPruneAt = now

  const retentionDays = readNonNegativeIntegerEnv(
    'CRADLE_CHAT_RUN_SNAPSHOT_RETENTION_DAYS',
    DEFAULT_RETENTION_DAYS,
  )
  if (retentionDays === 0) {
    return
  }

  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
  try {
    db()
      .delete(backendRunSnapshots)
      .where(and(
        lt(backendRunSnapshots.startedAt, cutoff),
        ne(backendRunSnapshots.status, 'running'),
      ))
      .run()
  }
  catch (error) {
    logger.error('failed to prune expired run snapshots', { error })
  }
}

function clampSnapshotLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 200
  }
  if (!Number.isFinite(limit)) {
    return 200
  }
  return Math.min(Math.max(Math.floor(limit), 1), 1000)
}
