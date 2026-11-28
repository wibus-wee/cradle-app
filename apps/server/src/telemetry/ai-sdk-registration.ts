import { OpenTelemetry } from '@ai-sdk/otel'
import { registerTelemetry } from 'ai'

/**
 * Register the AI SDK v7 OpenTelemetry integration once per process.
 *
 * AI SDK 7 removed the built-in OTel instrumentation (`experimental_telemetry`
 * with a tracer) in favor of globally registered telemetry integrations. Cradle
 * carries Langfuse correlation keys (`langfuse.session.id`,
 * `langfuse.trace.name`) through the call's `runtimeContext`; `enrichSpan`
 * copies every `langfuse.*` key verbatim onto the span attributes so Langfuse
 * can group generations into sessions, matching what other providers set
 * explicitly on their hand-created spans.
 *
 * Span emission lands in the process-wide OTel SDK configured in
 * `sdk-runtime.ts`; registration is a no-op cost when telemetry is disabled
 * because no OTel SDK is recording.
 */
export function registerAiSdkTelemetry(): void {
  registerTelemetry(new OpenTelemetry({
    enrichSpan: ({ runtimeContext }) => {
      if (!runtimeContext) {
        return undefined
      }
      const attributes: Record<string, string> = {}
      for (const [key, value] of Object.entries(runtimeContext)) {
        if (key.startsWith('langfuse.') && typeof value === 'string' && value.length > 0) {
          attributes[key] = value
        }
      }
      return Object.keys(attributes).length > 0 ? attributes : undefined
    },
  }))
}
