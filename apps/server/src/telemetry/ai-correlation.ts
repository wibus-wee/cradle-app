import { createHash } from 'node:crypto'

const AI_CORRELATION_NAMESPACE = 'cradle-ai-telemetry-v1'

export const AI_CORRELATION_SCHEMA_VERSION = 1

export interface AiTelemetryCorrelationContext {
  sessionId: string
  runId: string
}

export interface AiTelemetryCorrelationIds {
  sessionId: string
  runId: string
}

export function buildAiTelemetryCorrelationIds(
  input: AiTelemetryCorrelationContext,
): AiTelemetryCorrelationIds {
  return {
    sessionId: opaqueCorrelationId('session', input.sessionId),
    runId: opaqueCorrelationId('run', input.runId),
  }
}

/**
 * Build stable, opaque correlation attributes for exported AI spans.
 *
 * The input values are Cradle-owned identifiers and must never be exported
 * directly. Hashing also keeps the same logical session/run joinable across
 * server restarts without adding telemetry identifiers to the database.
 */
export function buildAiTelemetryCorrelationAttributes(
  input: AiTelemetryCorrelationContext,
): Record<string, string | number> {
  const ids = buildAiTelemetryCorrelationIds(input)
  return {
    'cradle.ai.correlation_version': AI_CORRELATION_SCHEMA_VERSION,
    'session_id': ids.sessionId,
    'run_id': ids.runId,
  }
}

function opaqueCorrelationId(scope: 'session' | 'run', value: string): string {
  return createHash('sha256')
    .update(AI_CORRELATION_NAMESPACE)
    .update('\0')
    .update(scope)
    .update('\0')
    .update(value)
    .digest('hex')
    .slice(0, 32)
}
