import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { IMetricReader } from '@opentelemetry/sdk-metrics'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

import type { TelemetryConfig } from './config'
import { createLangfuseSpanProcessor } from './langfuse'

function joinOtlpEndpoint(base: string, suffix: 'v1/traces' | 'v1/metrics'): string {
  return `${base.replace(/\/+$/, '')}/${suffix}`
}

export function createTraceSpanProcessors(config: TelemetryConfig): SpanProcessor[] {
  if (!config.tracesEnabled) {
    return []
  }

  const processors: SpanProcessor[] = []
  const traceUrl = config.otlpTracesEndpoint
    ?? (config.otlpEndpoint ? joinOtlpEndpoint(config.otlpEndpoint, 'v1/traces') : null)

  if (traceUrl) {
    processors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url: traceUrl })))
  }

  const langfuseProcessor = createLangfuseSpanProcessor()
  if (langfuseProcessor) {
    processors.push(langfuseProcessor)
  }

  return processors
}

export function createMetricReaders(config: TelemetryConfig): IMetricReader[] {
  if (!config.metricsEnabled) {
    return []
  }

  const readers: IMetricReader[] = []
  const metricsUrl = config.otlpMetricsEndpoint
    ?? (config.otlpEndpoint ? joinOtlpEndpoint(config.otlpEndpoint, 'v1/metrics') : null)

  if (metricsUrl) {
    readers.push(new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: metricsUrl }),
      exportIntervalMillis: 10_000,
    }))
  }

  if (config.prometheusEnabled) {
    readers.push(new PrometheusExporter({
      host: config.prometheusHost,
      port: config.prometheusPort,
      endpoint: config.prometheusEndpoint,
      prefix: '',
    }))
  }

  return readers
}
