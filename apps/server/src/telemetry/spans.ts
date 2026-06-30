import type { Span } from '@opentelemetry/api'
import { context, SpanStatusCode, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('cradle-server')

export function getActiveSpanContext():
  | { traceId: string, spanId: string, traceFlags: number }
  | null {
  const span = trace.getSpan(context.active())
  const spanContext = span?.spanContext()
  if (!spanContext) {
    return null
  }
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  }
}

export function getActiveLogTraceFields(): Record<string, unknown> | null {
  const spanContext = getActiveSpanContext()
  if (!spanContext) {
    return null
  }
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: `0${spanContext.traceFlags.toString(16)}`.slice(-2),
  }
}

function applySpanAttributes(span: Span, attrs: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || Array.isArray(value)
    ) {
      span.setAttribute(key, value)
    }
  }
}

function recordSpanError(span: Span, error: unknown): void {
  if (error instanceof Error) {
    span.recordException(error)
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
    return
  }
  span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
}

export function startCradleSpan<T>(
  name: string,
  attrs: Record<string, unknown>,
  fn: () => T,
): T {
  return tracer.startActiveSpan(name, (span) => {
    try {
      applySpanAttributes(span, attrs)
      return fn()
    }
    catch (error) {
      recordSpanError(span, error)
      throw error
    }
    finally {
      span.end()
    }
  })
}

export async function startCradleSpanAsync<T>(
  name: string,
  attrs: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      applySpanAttributes(span, attrs)
      return await fn()
    }
    catch (error) {
      recordSpanError(span, error)
      throw error
    }
    finally {
      span.end()
    }
  })
}
