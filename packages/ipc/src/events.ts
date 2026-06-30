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

const ValueSummarySchema = z.union([
  z.null().transform(() => 'null'),
  z.undefined().transform(() => 'undefined'),
  z.array(z.unknown()).transform(value => `Array(${value.length})`),
  z.instanceof(Error).transform(value => `${value.name}: ${value.message}`),
  z.string().transform(value => value.length > 80 ? `${value.slice(0, 80)}…` : value),
  z.unknown().transform((value) => {
    const boxed = new Object(value)
    if (boxed === value) {
      const name = boxed.constructor?.name
      return name && name !== 'Object'
        ? name
        : `Object(${Object.keys(boxed).length})`
    }
    return String(value)
  }),
])

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
    json = superjson.stringify(value)
  }
 catch (error) {
    json = superjson.stringify({
      unserializable: true,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const truncated = json.length > maxLength
  const preview = truncated ? `${json.slice(0, maxLength)}…` : json
  const summary = summarizeValue(value)

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
  return ValueSummarySchema.parse(value)
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
