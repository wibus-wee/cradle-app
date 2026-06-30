import { getTelemetryConfig } from './config'

let sdkRuntimeModule: Promise<typeof import('./sdk-runtime')> | null = null
let initialized = false

function logTelemetry(message: string): void {
  process.stderr.write(`[telemetry] ${message}\n`)
}

function loadTelemetrySdkRuntime(): Promise<typeof import('./sdk-runtime')> {
  sdkRuntimeModule ??= import('./sdk-runtime')
  return sdkRuntimeModule
}

export async function initializeTelemetry(): Promise<void> {
  if (initialized) {
    return
  }
  initialized = true

  const config = getTelemetryConfig()
  if (!config.enabled) {
    logTelemetry('OpenTelemetry disabled (set CRADLE_OTEL_ENABLED=1 to enable)')
    return
  }

  const runtime = await loadTelemetrySdkRuntime()
  runtime.startTelemetrySdk(config)
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdkRuntimeModule) {
    return
  }
  const runtime = await sdkRuntimeModule
  await runtime.shutdownTelemetrySdk()
}
