import { randomUUID } from 'node:crypto'

import type {
  ObservabilityCategory,
  ObservabilityEvent,
  ObservabilityIncident,
  ObservabilitySeverity,
  ObservabilitySource,
} from '@cradle/ipc'
import { z } from 'zod'

import { getActiveSpanContext } from '../../telemetry/spans'

export type {
  ObservabilityCategory,
  ObservabilityEvent,
  ObservabilityIncident,
  ObservabilitySeverity,
  ObservabilitySource,
} from '@cradle/ipc'

export const OBSERVABILITY_SCHEMA_VERSION = 1

export const OBSERVABILITY_CODES = {
  chatEmptyOutputCompletion: 'CHAT_EMPTY_OUTPUT_COMPLETION',
  chatLateRunFinalizationIgnored: 'CHAT_LATE_RUN_FINALIZATION_IGNORED',
  chatSessionTitleGenerationFailed: 'CHAT_SESSION_TITLE_GENERATION_FAILED',
  turnStreamFailed: 'TURN_STREAM_FAILED',
  domainEventHandlerFailed: 'DOMAIN_EVENT_HANDLER_FAILED',
  providerEmptyEventStream: 'PROVIDER_EMPTY_EVENT_STREAM',
  rendererUnhandledError: 'RENDERER_UNHANDLED_ERROR',
  rendererUnhandledRejection: 'RENDERER_UNHANDLED_REJECTION',
  rendererRenderError: 'RENDERER_RENDER_ERROR',
  desktopMainUncaughtException: 'DESKTOP_MAIN_UNCAUGHT_EXCEPTION',
  desktopMainUnhandledRejection: 'DESKTOP_MAIN_UNHANDLED_REJECTION',
  serverUncaughtException: 'SERVER_UNCAUGHT_EXCEPTION',
  serverUnhandledRejection: 'SERVER_UNHANDLED_REJECTION',
  serverBootstrapFatal: 'SERVER_BOOTSTRAP_FATAL',
  httpUnhandledError: 'HTTP_UNHANDLED_ERROR',
  diagnosticsHeapSnapshotWritten: 'DIAGNOSTICS_HEAP_SNAPSHOT_WRITTEN',
  diagnosticsHeapSnapshotFailed: 'DIAGNOSTICS_HEAP_SNAPSHOT_FAILED',
} as const

export interface CreateEventInput {
  source: ObservabilitySource
  code: string
  severity: ObservabilitySeverity
  category: ObservabilityCategory
  message: string
  attrs?: Record<string, unknown>
  chatSessionId?: string
  runId?: string
  messageId?: string
  traceId?: string
  dedupeKey?: string
  parentEventId?: string
  occurredAt?: number
  recordedAt?: number
}

const CreateEventInputSchema = z.object({
  source: z.custom<ObservabilitySource>(),
  code: z.string(),
  severity: z.custom<ObservabilitySeverity>(),
  category: z.custom<ObservabilityCategory>(),
  message: z.string(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  chatSessionId: z.string().optional(),
  runId: z.string().optional(),
  messageId: z.string().optional(),
  traceId: z.string().optional(),
  dedupeKey: z.string().optional(),
  parentEventId: z.string().optional(),
  occurredAt: z.number().optional(),
  recordedAt: z.number().optional(),
})

const DedupeKeyPartSchema = z.string().nullish().transform((value) => {
  if (value == null) {
    return '-'
  }
  return value
})

const DedupeKeyInputSchema = z.object({
  code: z.string(),
  chatSessionId: DedupeKeyPartSchema,
  runId: DedupeKeyPartSchema,
  handlerName: DedupeKeyPartSchema,
})

export function createObservabilityEvent(rawInput: CreateEventInput): ObservabilityEvent {
  const now = Date.now()
  const input = CreateEventInputSchema.extend({
    occurredAt: z.number().default(now),
    recordedAt: z.number().default(now),
  }).parse(rawInput)
  const activeSpanContext = getActiveSpanContext()
  const traceId = input.traceId ?? activeSpanContext?.traceId
  const attrs = activeSpanContext
    ? {
        ...input.attrs,
        otel: {
          ...(typeof input.attrs?.otel === 'object' && input.attrs.otel !== null ? input.attrs.otel : {}),
          traceId: activeSpanContext.traceId,
          spanId: activeSpanContext.spanId,
          traceFlags: activeSpanContext.traceFlags,
        },
      }
    : input.attrs
  return {
    id: randomUUID(),
    schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
    source: input.source,
    code: input.code,
    severity: input.severity,
    category: input.category,
    message: input.message,
    attrs,
    chatSessionId: input.chatSessionId,
    runId: input.runId,
    messageId: input.messageId,
    traceId,
    dedupeKey: input.dedupeKey,
    parentEventId: input.parentEventId,
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
  }
}

export interface DedupeKeyInput {
  code: string
  chatSessionId?: string | null
  runId?: string | null
  handlerName?: string | null
}

export function createDedupeKey(rawInput: DedupeKeyInput): string {
  const input = DedupeKeyInputSchema.parse(rawInput)
  return `${input.code}:${input.chatSessionId}:${input.runId}:${input.handlerName}`
}

export interface IncidentRowInput {
  dedupeKey: string
  code: string
  severity: ObservabilitySeverity
  source: ObservabilitySource
  message: string
  event: ObservabilityEvent
  attrs?: Record<string, unknown>
}

export function createIncidentFromEvent(input: IncidentRowInput): ObservabilityIncident {
  return {
    id: randomUUID(),
    dedupeKey: input.dedupeKey,
    code: input.code,
    severity: input.severity,
    status: 'open',
    source: input.source,
    message: input.message,
    chatSessionId: input.event.chatSessionId,
    runId: input.event.runId,
    messageId: input.event.messageId,
    firstOccurredAt: input.event.occurredAt,
    lastOccurredAt: input.event.occurredAt,
    lastRecordedAt: input.event.recordedAt,
    count: 1,
    lastEventId: input.event.id,
    attrs: input.attrs,
  }
}
