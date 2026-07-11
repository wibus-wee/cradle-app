import { trace } from '@opentelemetry/api'
import { HostMetrics } from '@opentelemetry/host-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'

import type { TelemetryConfig } from './config'
import { createMetricReaders, createTraceSpanProcessors } from './exporters'
import { createTelemetryInstrumentations } from './instrumentation'
import { bindLangfuseTracerProvider } from './langfuse'
import { initializeCradleMetrics } from './metrics'
import { createTelemetryResource } from './resource'
import { startRuntimeMetricSampler, stopRuntimeMetricSampler } from './runtime-sampler'

let sdk: NodeSDK | null = null
let hostMetrics: HostMetrics | null = null
let started = false

function logTelemetry(message: string): void {
  process.stderr.write(`[telemetry] ${message}\n`)
}

export function startTelemetrySdk(config: TelemetryConfig): void {
  if (started) {
    return
  }
  started = true

  const spanProcessors = createTraceSpanProcessors(config)
  const metricReaders = createMetricReaders(config)

  sdk = new NodeSDK({
    resource: createTelemetryResource(config),
    spanProcessors,
    metricReaders,
    instrumentations: createTelemetryInstrumentations(config),
  })
  sdk.start()
  bindLangfuseTracerProvider(trace.getTracerProvider())

  if (config.metricsEnabled) {
    initializeCradleMetrics()
    hostMetrics = new HostMetrics()
    hostMetrics.start()
    startRuntimeMetricSampler(config)
  }

  logTelemetry(`OpenTelemetry enabled service=${config.serviceName} traces=${config.tracesEnabled} metrics=${config.metricsEnabled}`)
  logTelemetry(config.langfuseEnabled ? 'Langfuse exporter enabled' : 'Langfuse exporter disabled')
  logTelemetry(config.posthogAiEnabled
    ? `PostHog AI Observability exporter enabled captureMode=${config.posthogAiCaptureMode}`
    : 'PostHog AI Observability exporter disabled')
  if (config.prometheusEnabled) {
    logTelemetry(`Prometheus metrics enabled http://${config.prometheusHost ?? '0.0.0.0'}:${config.prometheusPort}${config.prometheusEndpoint}`)
  }
}

export async function shutdownTelemetrySdk(): Promise<void> {
  if (!sdk) {
    return
  }
  try {
    await sdk.shutdown()
  }
  finally {
    stopRuntimeMetricSampler()
    bindLangfuseTracerProvider(null)
    sdk = null
    hostMetrics = null
  }
}
