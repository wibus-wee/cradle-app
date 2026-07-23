import type { ObservabilitySeverity } from '@cradle/ipc'
import { z } from 'zod'

import type { ObservabilityEvent, ObservabilityIncident } from './contract'
import { createDedupeKey, createIncidentFromEvent, OBSERVABILITY_CODES } from './contract'

export interface IncidentRuleInput {
  nowMs: number
  incoming: ObservabilityEvent
  recent: ObservabilityEvent[]
}

export interface IncidentRuleResult {
  incident: ObservabilityIncident
}

const FATAL_EVENT_CODES = new Set<string>([
  OBSERVABILITY_CODES.rendererUnhandledError,
  OBSERVABILITY_CODES.rendererUnhandledRejection,
  OBSERVABILITY_CODES.rendererRenderError,
  OBSERVABILITY_CODES.desktopMainUncaughtException,
  OBSERVABILITY_CODES.desktopMainUnhandledRejection,
  OBSERVABILITY_CODES.serverUncaughtException,
  OBSERVABILITY_CODES.serverUnhandledRejection,
  OBSERVABILITY_CODES.serverBootstrapFatal,
  OBSERVABILITY_CODES.httpUnhandledError,
])
const EventDedupeKeySchema = z.object({
  code: z.string(),
  dedupeKey: z.string().optional(),
}).transform(input => input.dedupeKey || createDedupeKey({ code: input.code }))

export function evaluateIncidentRules(input: IncidentRuleInput): IncidentRuleResult[] {
  const results: IncidentRuleResult[] = []
  const event = input.incoming

  if (event.code === OBSERVABILITY_CODES.turnStreamFailed && isErrorSeverity(event.severity)) {
    results.push({
      incident: createIncidentFromEvent({
        dedupeKey: EventDedupeKeySchema.parse(event),
        code: event.code,
        severity: event.severity,
        source: event.source,
        message: 'Chat turn streaming failed',
        event,
      }),
    })
  }

  if (event.code === OBSERVABILITY_CODES.chatUsageIngestionFailed && isErrorSeverity(event.severity)) {
    results.push({
      incident: createIncidentFromEvent({
        dedupeKey: EventDedupeKeySchema.parse(event),
        code: event.code,
        severity: event.severity,
        source: event.source,
        message: 'Chat usage ingestion failed',
        event,
      }),
    })
  }

  if (event.code === OBSERVABILITY_CODES.domainEventHandlerFailed && isErrorSeverity(event.severity)) {
    results.push({
      incident: createIncidentFromEvent({
        dedupeKey: EventDedupeKeySchema.parse(event),
        code: event.code,
        severity: event.severity,
        source: event.source,
        message: 'Domain event handler failed',
        event,
      }),
    })
  }

  if (FATAL_EVENT_CODES.has(event.code) && isErrorSeverity(event.severity)) {
    results.push({
      incident: createIncidentFromEvent({
        dedupeKey: EventDedupeKeySchema.parse(event),
        code: event.code,
        severity: event.severity,
        source: event.source,
        message: event.message,
        event,
      }),
    })
  }

  return results
}

function isErrorSeverity(severity: ObservabilitySeverity): boolean {
  return severity === 'error' || severity === 'fatal'
}
