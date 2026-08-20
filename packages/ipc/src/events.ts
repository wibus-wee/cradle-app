import {
  context as otelContext,
  propagation,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import superjson from 'superjson'
import { z } from 'zod'

export const IPC_DEVTOOL_METADATA_KEY = '__ipcDevtool'

const HYPHEN_RE = /-/g

export type IpcObservedSide = 'renderer' | 'main'
export type IpcObservedPhase = 'start' | 'finish'
export type IpcObservedStatus = 'pending' | 'success' | 'error'

export interface IpcTraceEnvelope {
  [IPC_DEVTOOL_METADATA_KEY]: true
  traceId: string
  spanId: string
  parentSpanId: string | null
  callerStack: string[]
  startedAt: number
}

export const IpcTraceEnvelopeSchema = z.object({
  [IPC_DEVTOOL_METADATA_KEY]: z.literal(true),
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  callerStack: z.array(z.string()),
  startedAt: z.number(),
})

export interface IpcObservedPayload {
  json: string
  summary: string
  truncated: boolean
}

export interface IpcObservedEvent {
  id: string
  traceId: string
  spanId: string
  parentSpanId: string | null
  channel: string
  side: IpcObservedSide
  phase: IpcObservedPhase
  status: IpcObservedStatus
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  args: IpcObservedPayload | null
  result: IpcObservedPayload | null
  error: IpcObservedPayload | null
  callerStack: string[]
  /**
   * Optional logical flow identifier for one-way push streams
   * (e.g. chat session id). All events sharing a flowId belong
   * to the same ordered sequence and can be grouped by the devtool UI.
   */
  flowId?: string
}

export interface SerializeValueOptions {
  maxLength?: number
}

const DEFAULT_MAX_LENGTH = 16_384
const MAX_PREVIEW_DEPTH = 5
const MAX_PREVIEW_ENTRIES = 50
const MAX_PREVIEW_NODES = 250
const MAX_PREVIEW_STRING_LENGTH = 2_048

interface PreviewState {
  nodes: number
  readonly seen: WeakSet<object>
}

function boundedPreview(value: unknown, state: PreviewState, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_PREVIEW_STRING_LENGTH
      ? `${value.slice(0, MAX_PREVIEW_STRING_LENGTH)}…`
      : value
  }
  if (value == null || typeof value !== 'object') {
    return value
  }
  if (value instanceof Error) {
    return {
      name: boundedPreview(value.name, state, depth + 1),
      message: boundedPreview(value.message, state, depth + 1),
      stack: boundedPreview(value.stack, state, depth + 1),
    }
  }
  if (value instanceof Date) {
    return value
  }
  if (ArrayBuffer.isView(value)) {
    return { type: value.constructor.name, byteLength: value.byteLength }
  }
  if (state.seen.has(value)) {
    return '[Circular]'
  }
  if (depth >= MAX_PREVIEW_DEPTH || state.nodes >= MAX_PREVIEW_NODES) {
    return `[${value.constructor?.name ?? 'Object'}]`
  }
  state.seen.add(value)
  state.nodes++

  if (Array.isArray(value)) {
    const preview = value
      .slice(0, MAX_PREVIEW_ENTRIES)
      .map(item => boundedPreview(item, state, depth + 1))
    if (value.length > MAX_PREVIEW_ENTRIES) {
      preview.push(`… ${value.length - MAX_PREVIEW_ENTRIES} more items`)
    }
    return preview
  }

  const preview: Record<string, unknown> = {}
  let count = 0
  for (const key in value) {
    if (!Object.hasOwn(value, key)) {
      continue
    }
    if (count >= MAX_PREVIEW_ENTRIES) {
      preview['…'] = 'more properties'
      break
    }
    preview[key] = boundedPreview((value as Record<string, unknown>)[key], state, depth + 1)
    count++
  }
  return preview
}

function createUuid(): string {
  return globalThis.crypto.randomUUID()
}

export function createTraceEnvelope(
  parentSpanId: string | null = null,
  callerStack: string[] = [],
): IpcTraceEnvelope {
  const traceId = createUuid().replace(HYPHEN_RE, '')
  const spanId = createUuid().replace(HYPHEN_RE, '').slice(0, 16)

  const carrier: Record<string, string> = {}
  const spanContext = {
    traceId,
    spanId,
    traceFlags: 1,
    isRemote: false,
  }

  propagation.inject(trace.setSpanContext(ROOT_CONTEXT, spanContext), carrier)

  return {
    [IPC_DEVTOOL_METADATA_KEY]: true,
    traceId: carrier.traceparent?.split('-')[1] ?? traceId,
    spanId: carrier.traceparent?.split('-')[2] ?? spanId,
    parentSpanId,
    callerStack,
    startedAt: Date.now(),
  }
}

export function captureCallerStack(): string[] {
  const stack = new Error('captureCallerStack').stack ?? ''
  return stack
    .split('\n')
    .slice(2)
    .map(line => line.trim())
    .filter(Boolean)
}

export function serializePayload(
  value: unknown,
  options: SerializeValueOptions = {},
): IpcObservedPayload {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH
  let json = ''

  try {
    json = superjson.stringify(boundedPreview(value, { nodes: 0, seen: new WeakSet() }))
  }
 catch (error) {
    json = superjson.stringify({
      unserializable: true,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const truncated = json.length > maxLength
  const preview = truncated ? `${json.slice(0, maxLength)}…` : json
  let summary: string
  try {
    summary = summarizeValue(value)
  }
  catch {
    summary = 'Unserializable value'
  }

  return {
    json: preview,
    summary,
    truncated,
  }
}

export function serializeError(error: unknown): IpcObservedPayload {
  if (error instanceof Error) {
    return serializePayload({
      name: error.name,
      message: error.message,
      stack: error.stack,
    })
  }

  return serializePayload(error)
}

export function createObservedEvent(input: Omit<IpcObservedEvent, 'id'>): IpcObservedEvent {
  return {
    id: createUuid(),
    ...input,
  }
}

export function summarizeValue(value: unknown): string {
  if (value === null) { return 'null' }
  if (value === undefined) { return 'undefined' }
  if (Array.isArray(value)) { return `Array(${value.length})` }
  if (value instanceof Error) {
    const summary = `${value.name}: ${value.message}`
    return summary.length > 80 ? `${summary.slice(0, 80)}…` : summary
  }
  if (typeof value === 'string') { return value.length > 80 ? `${value.slice(0, 80)}…` : value }
  if (typeof value !== 'object') { return String(value) }

  const name = value.constructor?.name
  if (name && name !== 'Object') { return name }

  let count = 0
  for (const key in value) {
    if (!Object.hasOwn(value, key)) { continue }
    count++
    if (count > MAX_PREVIEW_ENTRIES) { return `Object(${MAX_PREVIEW_ENTRIES}+)` }
  }
  return `Object(${count})`
}

export function markSpanSuccess(): void {
  const span = trace.getSpan(otelContext.active())
  span?.setStatus({ code: SpanStatusCode.OK })
  span?.end()
}

export function markSpanError(error: unknown): void {
  const span = trace.getSpan(otelContext.active())
  if (error instanceof Error) {
    span?.recordException(error)
  }
  span?.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  })
  span?.end()
}
