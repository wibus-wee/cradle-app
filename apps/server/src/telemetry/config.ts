export interface TelemetryConfig {
  enabled: boolean
  serviceName: string
  environment: string
  tracesEnabled: boolean
  metricsEnabled: boolean
  logCorrelationEnabled: boolean
  otlpEndpoint: string | null
  otlpTracesEndpoint: string | null
  otlpMetricsEndpoint: string | null
  prometheusEnabled: boolean
  prometheusHost: string | undefined
  prometheusPort: number
  prometheusEndpoint: string
  runtimeMetricsSampleIntervalMs: number
  langfuseEnabled: boolean
  profilingEnabled: boolean
  diagnosticsEnabled: boolean
}

function readFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  if (value === undefined || value === '') {
    return defaultValue
  }
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function readString(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}

function readPort(name: string, defaultValue: number): number {
  const raw = readString(name)
  if (!raw) {
    return defaultValue
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : defaultValue
}

function readPositiveInteger(name: string, defaultValue: number): number {
  const raw = readString(name)
  if (!raw) {
    return defaultValue
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue
}

let cachedConfig: TelemetryConfig | null = null

export function resetTelemetryConfigForTests(): void {
  cachedConfig = null
}

export function getTelemetryConfig(): TelemetryConfig {
  if (cachedConfig) {
    return cachedConfig
  }

  const testEnv = process.env.NODE_ENV === 'test'
  const enabled = readFlag('CRADLE_OTEL_ENABLED', false) && !testEnv
  const otlpEndpoint = readString('CRADLE_OTEL_EXPORTER_OTLP_ENDPOINT')
    ?? readString('OTEL_EXPORTER_OTLP_ENDPOINT')

  cachedConfig = {
    enabled,
    serviceName: readString('CRADLE_OTEL_SERVICE_NAME')
      ?? readString('OTEL_SERVICE_NAME')
      ?? 'cradle-server',
    environment: readString('CRADLE_OTEL_ENV')
      ?? readString('NODE_ENV')
      ?? 'development',
    tracesEnabled: enabled && readFlag('CRADLE_OTEL_TRACES_ENABLED', true),
    metricsEnabled: enabled && readFlag('CRADLE_OTEL_METRICS_ENABLED', true),
    logCorrelationEnabled: readFlag('CRADLE_OTEL_LOG_CORRELATION_ENABLED', true),
    otlpEndpoint,
    otlpTracesEndpoint: readString('CRADLE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT')
      ?? readString('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'),
    otlpMetricsEndpoint: readString('CRADLE_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT')
      ?? readString('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT'),
    prometheusEnabled: enabled && readFlag('CRADLE_OTEL_PROMETHEUS_ENABLED', false),
    prometheusHost: readString('CRADLE_OTEL_PROMETHEUS_HOST') ?? undefined,
    prometheusPort: readPort('CRADLE_OTEL_PROMETHEUS_PORT', 9464),
    prometheusEndpoint: readString('CRADLE_OTEL_PROMETHEUS_ENDPOINT') ?? '/metrics',
    runtimeMetricsSampleIntervalMs: readPositiveInteger('CRADLE_OTEL_RUNTIME_SAMPLE_INTERVAL_MS', 10_000),
    langfuseEnabled: enabled
      && readFlag('CRADLE_LANGFUSE_ENABLED', !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY))
      && !!process.env.LANGFUSE_PUBLIC_KEY
      && !!process.env.LANGFUSE_SECRET_KEY,
    profilingEnabled: enabled && readFlag('CRADLE_PROFILING_ENABLED', false),
    diagnosticsEnabled: readFlag('CRADLE_DIAGNOSTICS_ENABLED', false),
  }

  return cachedConfig
}

export function telemetryEnabled(): boolean {
  return getTelemetryConfig().enabled
}

export function aiTelemetryEnabled(): boolean {
  const config = getTelemetryConfig()
  return config.enabled && config.tracesEnabled
}

export function langfuseExporterEnabled(): boolean {
  return getTelemetryConfig().langfuseEnabled
}
