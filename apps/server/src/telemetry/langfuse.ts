import { LangfuseSpanProcessor } from '@langfuse/otel'
import { setLangfuseTracerProvider } from '@langfuse/tracing'
import type { TracerProvider } from '@opentelemetry/api'
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base'

import { langfuseExporterEnabled } from './config'

export { langfuseExporterEnabled as langfuseEnabled }

export function createLangfuseSpanProcessor(): SpanProcessor | null {
  if (!langfuseExporterEnabled()) {
    return null
  }
  return new LangfuseSpanProcessor()
}

export function bindLangfuseTracerProvider(provider: TracerProvider | null): void {
  if (!langfuseExporterEnabled()) {
    setLangfuseTracerProvider(null)
    return
  }
  setLangfuseTracerProvider(provider)
}
