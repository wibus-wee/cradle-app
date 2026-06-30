import type { TelemetryConfig } from './config'

let samplerTimer: ReturnType<typeof setInterval> | null = null
let sampling = false

async function sampleRuntimeMetrics(): Promise<void> {
  if (sampling) {
    return
  }
  sampling = true
  try {
    const { getRuntimeSnapshot } = await import('../modules/observability/runtime-snapshot')
    await getRuntimeSnapshot()
  }
  catch (error) {
    process.stderr.write(`[telemetry] runtime metric sample failed: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  finally {
    sampling = false
  }
}

export function startRuntimeMetricSampler(config: TelemetryConfig): void {
  if (!config.metricsEnabled || samplerTimer) {
    return
  }
  void sampleRuntimeMetrics()
  samplerTimer = setInterval(() => {
    void sampleRuntimeMetrics()
  }, config.runtimeMetricsSampleIntervalMs)
  samplerTimer.unref?.()
}

export function stopRuntimeMetricSampler(): void {
  if (!samplerTimer) {
    return
  }
  clearInterval(samplerTimer)
  samplerTimer = null
}
