import type { BackendRunSnapshot, BackendRunSnapshotEvent, NewObservabilityEventRow, ObservabilityEventRow, ObservabilityIncidentRow } from '@cradle/db'
import { backendRunSnapshotEvents, backendRunSnapshots, observabilityEvents, observabilityIncidents } from '@cradle/db'
import type { SQL } from 'drizzle-orm'
import { and, desc, eq, gte } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { recordObservabilityDroppedEvents } from '../../telemetry/metrics'
import type { CreateEventInput, ObservabilityEvent, ObservabilityIncident } from './contract'
import {
  createDedupeKey,
  createObservabilityEvent,
  OBSERVABILITY_CODES,
} from './contract'
import type { ExportObservabilityBundleInput, ObservabilityBundle } from './exporter'
import { exportObservabilityBundle } from './exporter'
import { evaluateIncidentRules } from './rules'

const logger = createChildLogger({ module: 'observability' })

const HandlerAttrsSchema = z.object({
  handlerName: z.string().min(1).nullable().default(null),
}).passthrough().prefault(() => ({ handlerName: null }))

const EventDedupeProjectionSchema = z.object({
  dedupeKey: z.string(),
})

const EventPersistenceProjectionSchema = z.object({
  chatSessionId: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  traceId: z.string().nullable().default(null),
  dedupeKey: z.string().nullable().default(null),
  parentEventId: z.string().nullable().default(null),
})

const ObservabilityAttrsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.record(z.string(), z.unknown()))

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

export interface ObservabilityEventFilter {
  chatSessionId?: string
  runId?: string
  code?: string
  severity?: string
  since?: number
  until?: number
  limit?: number
}

export interface ObservabilityIncidentFilter {
  dedupeKey?: string
  code?: string
  status?: 'open' | 'resolved'
  chatSessionId?: string
  runId?: string
  limit?: number
}

export interface ObservabilityErrorPatternFilter {
  chatSessionId?: string
  runId?: string
  code?: string
  runtimeKind?: string
  providerTargetId?: string
  sinceUnix?: number
  limit?: number
}

export interface ObservabilityErrorPattern {
  patternId: string
  source: 'event' | 'run-snapshot'
  code: string
  category: string
  severity: string
  runtimeKind?: string
  providerTargetId?: string
  modelId?: string
  messageFingerprint: string
  messagePreview: string
  count: number
  firstSeenAt: number
  lastSeenAt: number
  sampleRunIds: string[]
  sampleTraceIds: string[]
  sampleMessages: string[]
}

export interface DesktopRuntimeSample {
  source: 'desktop-main'
  sampledAt: number
  main: Record<string, unknown>
  appMetrics: Array<Record<string, unknown>>
  windows: Array<Record<string, unknown>>
  diagnostics?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Queue state (module-level singleton)
// ---------------------------------------------------------------------------

const MAX_RECENT_EVENTS = 2000
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_FLUSH_INTERVAL_MS = 400
const DEFAULT_MAX_QUEUE_SIZE = 5000

interface QueuedObservabilityEvent {
  event: ObservabilityEvent
  storageKey: string
}

const queue: QueuedObservabilityEvent[] = []
const recentEvents: ObservabilityEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let activeFlush: Promise<void> | null = null
let closed = false
let droppedEvents = 0
const desktopRuntimeSamples: DesktopRuntimeSample[] = []

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function record(input: CreateEventInput): void {
  try {
    const event = createObservabilityEvent(input)
    const dedupeProjection = EventDedupeProjectionSchema.partial().extend({
      dedupeKey: z.string().default(() => createDefaultDedupeKey(event)),
    }).parse(event)
    const recordedEvent = { ...event, dedupeKey: dedupeProjection.dedupeKey }

    enqueueEvent(recordedEvent)
    applyRules(recordedEvent)
    appendRecentEvent(recordedEvent)
  }
  catch (error) {
    logger.error('failed to record event', { input, error })
  }
}

function createDefaultDedupeKey(event: ObservabilityEvent): string {
  if (event.code === OBSERVABILITY_CODES.turnStreamFailed) {
    return createDedupeKey({ code: event.code })
  }

  return createDedupeKey({
    code: event.code,
    chatSessionId: event.chatSessionId,
    runId: event.runId,
    handlerName: HandlerAttrsSchema.parse(event.attrs).handlerName,
  })
}

export async function flushEvents(): Promise<void> {
  if (closed && queue.length === 0) {
    return
  }
  if (activeFlush) {
    return activeFlush
  }

  activeFlush = Promise.resolve().then(() => {
    while (queue.length > 0) {
      const batch = queue.splice(0, DEFAULT_BATCH_SIZE)
      persistBatch(batch)
    }
  }).finally(() => {
    activeFlush = null
  })

  return activeFlush
}

export function getEvents(filter: ObservabilityEventFilter = {}): ObservabilityEvent[] {
  const rows = db().select().from(observabilityEvents).orderBy(desc(observabilityEvents.recordedAt)).all()

  return rows
    .filter((row) => {
      if (filter.chatSessionId && row.chatSessionId !== filter.chatSessionId) {
        return false
      }
      if (filter.runId && row.runId !== filter.runId) {
        return false
      }
      if (filter.code && row.code !== filter.code) {
        return false
      }
      if (filter.severity && row.severity !== filter.severity) {
        return false
      }
      if (filter.since !== undefined && row.recordedAt < filter.since) {
        return false
      }
      if (filter.until !== undefined && row.recordedAt > filter.until) {
        return false
      }
      return true
    })
    .slice(0, filter.limit ?? 2000)
    .map(toObservabilityEvent)
}

export function getIncidents(filter: ObservabilityIncidentFilter = {}): ObservabilityIncident[] {
  const rows = db().select().from(observabilityIncidents).orderBy(desc(observabilityIncidents.lastRecordedAt)).all()

  return rows
    .filter((row) => {
      if (filter.dedupeKey && row.dedupeKey !== filter.dedupeKey) {
        return false
      }
      if (filter.code && row.code !== filter.code) {
        return false
      }
      if (filter.status && row.status !== filter.status) {
        return false
      }
      if (filter.chatSessionId && row.chatSessionId !== filter.chatSessionId) {
        return false
      }
      if (filter.runId && row.runId !== filter.runId) {
        return false
      }
      return true
    })
    .slice(0, filter.limit ?? 2000)
    .map(toObservabilityIncident)
}

export function getErrorPatterns(filter: ObservabilityErrorPatternFilter = {}): ObservabilityErrorPattern[] {
  const patterns = new Map<string, MutableErrorPattern>()

  for (const event of getEvents({
    chatSessionId: filter.chatSessionId,
    runId: filter.runId,
    code: filter.code,
    since: filter.sinceUnix === undefined ? undefined : filter.sinceUnix * 1000,
    limit: 10000,
  })) {
    if (!isErrorSeverity(event.severity)) {
      continue
    }
    const runtimeKind = readOptionalString(event.attrs?.runtimeKind)
    const providerTargetId = readOptionalString(event.attrs?.providerTargetId)
    if (filter.runtimeKind && runtimeKind !== filter.runtimeKind) {
      continue
    }
    if (filter.providerTargetId && providerTargetId !== filter.providerTargetId) {
      continue
    }
    addErrorPattern(patterns, {
      source: 'event',
      code: event.code,
      category: event.category,
      severity: event.severity,
      runtimeKind,
      providerTargetId,
      modelId: readOptionalString(event.attrs?.modelId),
      message: event.message,
      seenAt: event.recordedAt,
      runId: event.runId,
      traceId: event.traceId,
    })
  }

  const snapshotRows = db()
    .select()
    .from(backendRunSnapshots)
    .orderBy(desc(backendRunSnapshots.startedAt))
    .all()

  for (const row of snapshotRows) {
    if (row.status !== 'failed' || !row.errorText) {
      continue
    }
    if (filter.chatSessionId && row.chatSessionId !== filter.chatSessionId) {
      continue
    }
    if (filter.runId && row.runId !== filter.runId) {
      continue
    }
    if (filter.sinceUnix !== undefined && row.startedAt < filter.sinceUnix * 1000) {
      continue
    }
    if (filter.runtimeKind && row.runtimeKind !== filter.runtimeKind) {
      continue
    }
    if (filter.providerTargetId && row.providerTargetId !== filter.providerTargetId) {
      continue
    }
    const code = row.completionReason === 'error' ? 'RUN_FAILED' : `RUN_${normalizePatternToken(row.completionReason ?? 'failed')}`
    if (filter.code && code !== filter.code) {
      continue
    }
    addErrorPattern(patterns, {
      source: 'run-snapshot',
      code,
      category: 'chat',
      severity: 'error',
      runtimeKind: row.runtimeKind,
      providerTargetId: row.providerTargetId ?? undefined,
      modelId: row.modelId ?? undefined,
      message: row.errorText,
      seenAt: row.completedAt ?? row.startedAt,
      runId: row.runId ?? undefined,
      traceId: row.traceId,
    })
  }

  return [...patterns.values()]
    .sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
    .slice(0, filter.limit ?? 200)
    .map(pattern => ({
      patternId: pattern.patternId,
      source: pattern.source,
      code: pattern.code,
      category: pattern.category,
      severity: pattern.severity,
      runtimeKind: pattern.runtimeKind,
      providerTargetId: pattern.providerTargetId,
      modelId: pattern.modelId,
      messageFingerprint: pattern.messageFingerprint,
      messagePreview: pattern.messagePreview,
      count: pattern.count,
      firstSeenAt: pattern.firstSeenAt,
      lastSeenAt: pattern.lastSeenAt,
      sampleRunIds: [...pattern.sampleRunIds],
      sampleTraceIds: [...pattern.sampleTraceIds],
      sampleMessages: pattern.sampleMessages,
    }))
}

export function getExportBundle(input: ExportObservabilityBundleInput): ObservabilityBundle {
  return exportObservabilityBundle(input, {
    db: db(),
    queryEvents: getEvents,
    queryIncidents: getIncidents,
    queryErrorPatterns: getErrorPatterns,
    queryTimeline: getTimeline,
  })
}

export function getQueueHealth() {
  return {
    queueDepth: queue.length,
    recentEvents: recentEvents.length,
    droppedEvents,
    pendingFlush: activeFlush !== null,
  }
}

export function recordDesktopRuntimeSample(sample: DesktopRuntimeSample): { ok: true } {
  desktopRuntimeSamples.push(sample)
  if (desktopRuntimeSamples.length > 20) {
    desktopRuntimeSamples.splice(0, desktopRuntimeSamples.length - 20)
  }
  return { ok: true }
}

export function getDesktopRuntimeSamples(): DesktopRuntimeSample[] {
  return [...desktopRuntimeSamples]
}

export async function shutdown(): Promise<void> {
  closed = true
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  await flushEvents()
}

// ---------------------------------------------------------------------------
// Incident upsert (used internally and by exporter)
// ---------------------------------------------------------------------------

export function upsertIncident(incident: ObservabilityIncident): void {
  const d = db()
  const existing = d.select()
    .from(observabilityIncidents)
    .where(eq(observabilityIncidents.dedupeKey, incident.dedupeKey))
    .get()

  if (!existing) {
    d.insert(observabilityIncidents)
      .values({
        id: incident.id,
        dedupeKey: incident.dedupeKey,
        code: incident.code,
        severity: incident.severity,
        status: incident.status,
        source: incident.source,
        message: incident.message,
        chatSessionId: incident.chatSessionId ?? null,
        runId: incident.runId ?? null,
        messageId: incident.messageId ?? null,
        firstOccurredAt: incident.firstOccurredAt,
        lastOccurredAt: incident.lastOccurredAt,
        lastRecordedAt: incident.lastRecordedAt,
        count: incident.count,
        lastEventId: null,
        attrsJson: incident.attrs ? JSON.stringify(incident.attrs) : null,
      })
      .run()
    return
  }

  d.update(observabilityIncidents)
    .set({
      severity: mergeSeverity(existing.severity, incident.severity),
      status: incident.status,
      source: incident.source,
      message: incident.message,
      chatSessionId: incident.chatSessionId ?? existing.chatSessionId,
      runId: incident.runId ?? existing.runId,
      messageId: incident.messageId ?? existing.messageId,
      firstOccurredAt: Math.min(existing.firstOccurredAt, incident.firstOccurredAt),
      lastOccurredAt: Math.max(existing.lastOccurredAt, incident.lastOccurredAt),
      lastRecordedAt: Math.max(existing.lastRecordedAt, incident.lastRecordedAt),
      count: existing.count + 1,
      lastEventId: null,
      attrsJson: incident.attrs ? JSON.stringify(incident.attrs) : existing.attrsJson,
    })
    .where(eq(observabilityIncidents.id, existing.id))
    .run()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function enqueueEvent(event: ObservabilityEvent): void {
  if (closed) {
    return
  }

  if (queue.length >= DEFAULT_MAX_QUEUE_SIZE) {
    droppedEvents += 1
    recordObservabilityDroppedEvents(1)
    if (droppedEvents % 100 === 1) {
      logger.error('queue is full; dropping new events', {
        maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
        droppedTotal: droppedEvents,
      })
    }
    return
  }

  queue.push({
    event,
    storageKey: currentStorageKey(),
  })
  if (queue.length >= DEFAULT_BATCH_SIZE) {
    scheduleFlush(0)
    return
  }
  scheduleFlush(DEFAULT_FLUSH_INTERVAL_MS)
}

function appendRecentEvent(event: ObservabilityEvent): void {
  recentEvents.push(event)
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_RECENT_EVENTS)
  }
}

function applyRules(event: ObservabilityEvent): void {
  const results = evaluateIncidentRules({
    nowMs: Date.now(),
    incoming: event,
    recent: recentEvents,
  })
  for (const result of results) {
    upsertIncident(result.incident)
  }
}

function scheduleFlush(delayMs: number): void {
  if (closed || timer) {
    return
  }
  timer = setTimeout(() => {
    timer = null
    void flushEvents()
  }, delayMs)
}

function persistBatch(batch: QueuedObservabilityEvent[]): void {
  if (batch.length === 0) {
    return
  }

  const storageKey = currentStorageKey()
  const events = batch.flatMap(item => item.storageKey === storageKey ? [item.event] : [])
  const staleEvents = batch.length - events.length
  if (staleEvents > 0) {
    droppedEvents += staleEvents
    recordObservabilityDroppedEvents(staleEvents)
    logger.warn('dropping observability events from a previous storage context', {
      droppedBatch: staleEvents,
      droppedTotal: droppedEvents,
    })
  }

  if (events.length === 0) {
    return
  }

  const rows = events.map(toObservabilityEventRow)
  try {
    db().insert(observabilityEvents).values(rows).run()
    return
  }
  catch (error) {
    logger.warn('failed to persist observability batch; retrying events individually', {
      batchSize: batch.length,
      error,
    })
  }

  let droppedBatchEvents = 0
  for (const row of rows) {
    try {
      db().insert(observabilityEvents).values(row).run()
    }
    catch (error) {
      droppedBatchEvents += 1
      if (droppedBatchEvents === 1) {
        logger.error('failed to persist observability event; dropping event', {
          eventId: row.id,
          code: row.code,
          chatSessionId: row.chatSessionId,
          runId: row.runId,
          messageId: row.messageId,
          error,
        })
      }
    }
  }

  if (droppedBatchEvents > 0) {
    droppedEvents += droppedBatchEvents
    recordObservabilityDroppedEvents(droppedBatchEvents)
  }
}

function toObservabilityEventRow(event: ObservabilityEvent): NewObservabilityEventRow {
  const persisted = EventPersistenceProjectionSchema.parse(event)
  return {
    id: event.id,
    schemaVersion: event.schemaVersion,
    source: event.source,
    code: event.code,
    severity: event.severity,
    category: event.category,
    message: event.message,
    attrsJson: event.attrs ? JSON.stringify(event.attrs) : null,
    chatSessionId: persisted.chatSessionId,
    runId: persisted.runId,
    messageId: persisted.messageId,
    traceId: persisted.traceId,
    dedupeKey: persisted.dedupeKey,
    parentEventId: persisted.parentEventId,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
  }
}

function currentStorageKey(): string {
  return [
    process.env.CRADLE_DATA_DIR ?? '',
    process.env.CRADLE_DB_PATH ?? '',
  ].join('\0')
}

interface ErrorPatternInput {
  source: ObservabilityErrorPattern['source']
  code: string
  category: string
  severity: string
  runtimeKind?: string
  providerTargetId?: string
  modelId?: string
  message: string
  seenAt: number
  runId?: string
  traceId?: string
}

interface MutableErrorPattern extends Omit<ObservabilityErrorPattern, 'sampleRunIds' | 'sampleTraceIds'> {
  sampleRunIds: Set<string>
  sampleTraceIds: Set<string>
}

function addErrorPattern(patterns: Map<string, MutableErrorPattern>, input: ErrorPatternInput): void {
  const messageFingerprint = fingerprintErrorMessage(input.message)
  const patternId = [
    input.source,
    input.code,
    input.runtimeKind ?? '-',
    input.providerTargetId ?? '-',
    input.modelId ?? '-',
    messageFingerprint,
  ].join(':')

  const existing = patterns.get(patternId)
  if (existing) {
    existing.count += 1
    existing.firstSeenAt = Math.min(existing.firstSeenAt, input.seenAt)
    existing.lastSeenAt = Math.max(existing.lastSeenAt, input.seenAt)
    if (input.runId) {
      existing.sampleRunIds.add(input.runId)
    }
    if (input.traceId) {
      existing.sampleTraceIds.add(input.traceId)
    }
    if (existing.sampleMessages.length < 3 && !existing.sampleMessages.includes(input.message)) {
      existing.sampleMessages.push(input.message)
    }
    return
  }

  patterns.set(patternId, {
    patternId,
    source: input.source,
    code: input.code,
    category: input.category,
    severity: input.severity,
    runtimeKind: input.runtimeKind,
    providerTargetId: input.providerTargetId,
    modelId: input.modelId,
    messageFingerprint,
    messagePreview: previewErrorMessage(input.message),
    count: 1,
    firstSeenAt: input.seenAt,
    lastSeenAt: input.seenAt,
    sampleRunIds: new Set(input.runId ? [input.runId] : []),
    sampleTraceIds: new Set(input.traceId ? [input.traceId] : []),
    sampleMessages: [input.message],
  })
}

function fingerprintErrorMessage(message: string): string {
  return normalizeErrorMessage(message).slice(0, 180)
}

function normalizeErrorMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/g, '<uuid>')
    .replace(/\b\d{3,}\b/g, '<number>')
    .replace(/\breq_[a-z0-9_-]+\b/g, '<request-id>')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePatternToken(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return normalized || 'FAILED'
}

function previewErrorMessage(message: string): string {
  return message.length > 320 ? `${message.slice(0, 317)}...` : message
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isErrorSeverity(severity: string): boolean {
  return severity === 'error' || severity === 'fatal'
}

function getTimeline(filter: {
  chatSessionId?: string
  runId?: string
  since?: number
  limit?: number
}): Array<Record<string, unknown>> {
  const conditions: SQL[] = []
  if (filter.chatSessionId) {
    conditions.push(eq(backendRunSnapshots.chatSessionId, filter.chatSessionId))
  }
  if (filter.runId) {
    conditions.push(eq(backendRunSnapshots.runId, filter.runId))
  }
  if (filter.since !== undefined) {
    conditions.push(gte(backendRunSnapshots.startedAt, filter.since))
  }

  const limit = clampTimelineLimit(filter.limit)
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

  return rows.map((row) => {
    const events = db()
      .select()
      .from(backendRunSnapshotEvents)
      .where(eq(backendRunSnapshotEvents.snapshotId, row.id))
      .all()
      .sort((a, b) => a.seq - b.seq)
    return toTimelineSnapshot(row, events)
  })
}

function clampTimelineLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 200
  }
  if (!Number.isFinite(limit)) {
    return 200
  }
  return Math.min(Math.max(Math.floor(limit), 1), 1000)
}

function mergeSeverity(current: string, next: string): ObservabilityIncident['severity'] {
  return severityPriority(next) >= severityPriority(current)
    ? (next as ObservabilityIncident['severity'])
    : (current as ObservabilityIncident['severity'])
}

function severityPriority(value: string): number {
  switch (value) {
    case 'fatal': return 5
    case 'error': return 4
    case 'warn': return 3
    case 'info': return 2
    case 'debug':
    default: return 1
  }
}

function toObservabilityEvent(row: ObservabilityEventRow): ObservabilityEvent {
  return {
    id: row.id,
    schemaVersion: row.schemaVersion,
    source: row.source as ObservabilityEvent['source'],
    code: row.code,
    severity: row.severity as ObservabilityEvent['severity'],
    category: row.category as ObservabilityEvent['category'],
    message: row.message,
    attrs: row.attrsJson ? ObservabilityAttrsJsonSchema.parse(row.attrsJson) : undefined,
    chatSessionId: row.chatSessionId ?? undefined,
    runId: row.runId ?? undefined,
    messageId: row.messageId ?? undefined,
    traceId: row.traceId ?? undefined,
    dedupeKey: row.dedupeKey ?? undefined,
    parentEventId: row.parentEventId ?? undefined,
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
  }
}

function toObservabilityIncident(row: ObservabilityIncidentRow): ObservabilityIncident {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    code: row.code,
    severity: row.severity as ObservabilityIncident['severity'],
    status: row.status as ObservabilityIncident['status'],
    source: row.source as ObservabilityIncident['source'],
    message: row.message,
    chatSessionId: row.chatSessionId ?? undefined,
    runId: row.runId ?? undefined,
    messageId: row.messageId ?? undefined,
    firstOccurredAt: row.firstOccurredAt,
    lastOccurredAt: row.lastOccurredAt,
    lastRecordedAt: row.lastRecordedAt,
    count: row.count,
    lastEventId: row.lastEventId ?? undefined,
    attrs: row.attrsJson ? ObservabilityAttrsJsonSchema.parse(row.attrsJson) : undefined,
  }
}

function toTimelineSnapshot(
  row: BackendRunSnapshot,
  events: BackendRunSnapshotEvent[],
): Record<string, unknown> {
  return {
    schema: 'cradle.backend-run-snapshot.v1',
    id: row.id,
    schemaVersion: row.schemaVersion,
    traceId: row.traceId,
    chatSessionId: row.chatSessionId,
    runId: row.runId,
    messageId: row.messageId,
    providerTargetId: row.providerTargetId,
    runtimeKind: row.runtimeKind,
    providerSessionId: row.providerSessionId,
    modelId: row.modelId,
    agentId: row.agentId,
    workspaceId: row.workspaceId,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    completionReason: row.completionReason,
    errorText: row.errorText,
    summary: row.summaryJson ? ObservabilityAttrsJsonSchema.parse(row.summaryJson) : {},
    events: events.map(event => ({
      id: event.id,
      seq: event.seq,
      phase: event.phase,
      chunkType: event.chunkType,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      modelId: event.modelId,
      promptTokens: event.promptTokens,
      completionTokens: event.completionTokens,
      totalTokens: event.totalTokens,
      estimatedCostUsd: event.estimatedCostUsd,
      occurredAt: event.occurredAt,
      durationMs: event.durationMs,
      payload: event.payloadJson ? ObservabilityAttrsJsonSchema.parse(event.payloadJson) : {},
    })),
  }
}
