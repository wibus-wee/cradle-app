import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'

import type { TelemetryConfig } from './config'

export function createTelemetryInstrumentations(config: TelemetryConfig) {
  return getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': {
      enabled: false,
    },
    '@opentelemetry/instrumentation-pino': {
      enabled: config.logCorrelationEnabled,
      disableLogSending: true,
      disableLogCorrelation: false,
      logKeys: {
        traceId: 'traceId',
        spanId: 'spanId',
        traceFlags: 'traceFlags',
      },
    },
    '@opentelemetry/instrumentation-runtime-node': {
      enabled: config.metricsEnabled,
    },
  })
}
