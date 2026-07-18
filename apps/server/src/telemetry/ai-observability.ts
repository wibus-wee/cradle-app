import { SpanStatusCode, trace } from '@opentelemetry/api'

import type { AiTelemetryCorrelationContext } from './ai-correlation'
import {
  buildAiTelemetryCorrelationAttributes,
} from './ai-correlation'
import { getTelemetryConfig } from './config'
import { POSTHOG_AI_EXPORT_ATTRIBUTE } from './posthog-ai'

interface AiGenerationUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
  reasoningOutputTokens?: number
}

export interface AiGenerationObservationInput {
  correlation: AiTelemetryCorrelationContext
  runtimeKind: string
  providerKind: string
  requestedModelId: string | null
  internalContinuation: boolean
  inputMessages: () => unknown[]
}

export interface AiGenerationObservationResult {
  modelId: string | null
  usage: AiGenerationUsage | null
  estimatedCostUsd: number | null
  timeToFirstTokenMs: number | null
  outcome: 'success' | 'failed' | 'cancelled'
  stopReason: string
  outputChoices: unknown[]
  tools: string[]
}

const aiTracer = trace.getTracer('cradle-server-ai-observability')

interface AiGenerationAttributeWriter {
  setAttribute: (name: string, value: string | number | boolean) => unknown
  setStatus: (status: { code: SpanStatusCode }) => unknown
}

export async function observeAiGeneration<T extends AiGenerationObservationResult>(
  input: AiGenerationObservationInput,
  execute: (captureMode: 'metadata' | 'full') => Promise<T>,
): Promise<T> {
  const config = getTelemetryConfig()
  if (!config.tracesEnabled || !config.posthogAiEnabled) {
    return execute('metadata')
  }

  const captureMode = config.posthogAiCaptureMode

  return aiTracer.startActiveSpan('gen_ai.chat', {
    attributes: buildAiGenerationStartAttributes(input, captureMode),
  }, async (span) => {
    const spanContext = span.spanContext()
    span.setAttribute('$ai_trace_id', spanContext.traceId)
    span.setAttribute('$ai_span_id', spanContext.spanId)
    try {
      const result = await execute(captureMode)
      applyAiGenerationResult(span, result, captureMode)
      return result
    }
    catch (error) {
      span.setAttribute('$ai_is_error', true)
      span.setAttribute('cradle.outcome', 'failed')
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw error
    }
    finally {
      span.end()
    }
  })
}

export function buildAiGenerationStartAttributes(
  input: AiGenerationObservationInput,
  captureMode: 'metadata' | 'full',
): Record<string, string | number | boolean> {
  return {
    [POSTHOG_AI_EXPORT_ATTRIBUTE]: true,
    ...buildAiTelemetryCorrelationAttributes(input.correlation),
    'gen_ai.operation.name': 'chat',
    'gen_ai.provider.name': input.providerKind,
    ...(input.requestedModelId ? { 'gen_ai.request.model': input.requestedModelId } : {}),
    'cradle.ai.schema_version': 2,
    'cradle.ai.capture_mode': captureMode,
    'cradle.runtime_kind': input.runtimeKind,
    'cradle.internal_continuation': input.internalContinuation,
    '$ai_stream': true,
    '$ai_span_name': 'chat.agent_run',
    ...(captureMode === 'full'
      ? { 'gen_ai.input.messages': JSON.stringify(input.inputMessages()) }
      : {}),
  }
}

export function applyAiGenerationResult(
  span: AiGenerationAttributeWriter,
  result: AiGenerationObservationResult,
  captureMode: 'metadata' | 'full',
): void {
  if (result.modelId) {
    span.setAttribute('gen_ai.response.model', result.modelId)
  }
  if (result.usage) {
    span.setAttribute('gen_ai.usage.input_tokens', result.usage.promptTokens)
    span.setAttribute('gen_ai.usage.output_tokens', result.usage.completionTokens)
    span.setAttribute('cradle.ai.total_tokens', result.usage.totalTokens)
    span.setAttribute('$ai_cache_read_input_tokens', result.usage.cachedInputTokens ?? 0)
    span.setAttribute('$ai_cache_creation_input_tokens', result.usage.cacheWriteInputTokens ?? 0)
    span.setAttribute('cradle.ai.reasoning_output_tokens', result.usage.reasoningOutputTokens ?? 0)
  }
  if (captureMode === 'full') {
    span.setAttribute('gen_ai.output.messages', JSON.stringify(result.outputChoices))
    span.setAttribute('$ai_tools', JSON.stringify(result.tools))
  }
  if (result.estimatedCostUsd !== null) {
    span.setAttribute('$ai_total_cost_usd', result.estimatedCostUsd)
  }
  if (result.timeToFirstTokenMs !== null) {
    span.setAttribute('$ai_time_to_first_token', result.timeToFirstTokenMs / 1000)
  }
  span.setAttribute('$ai_is_error', result.outcome === 'failed')
  span.setAttribute('$ai_stop_reason', result.stopReason)
  span.setAttribute('cradle.outcome', result.outcome)
  span.setStatus({
    code: result.outcome === 'failed' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
  })
}
