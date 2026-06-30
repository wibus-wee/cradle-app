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

const EMPTY_OUTPUT_WINDOW_MS = 5 * 60 * 1000
const EMPTY_OUTPUT_THRESHOLD = 3
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

  if (event.code === OBSERVABILITY_CODES.chatEmptyOutputCompletion) {
    const dedupeKey = EventDedupeKeySchema.parse(event)
    const occurrences = countRecentOccurrences(input, OBSERVABILITY_CODES.chatEmptyOutputCompletion, dedupeKey)
    if (occurrences >= EMPTY_OUTPUT_THRESHOLD) {
      results.push({
        incident: createIncidentFromEvent({
          dedupeKey,
          code: event.code,
          severity: event.severity,
          source: event.source,
          message: `Observed ${occurrences} empty-output completions in the last 5 minutes`,
          event,
          attrs: {
            threshold: EMPTY_OUTPUT_THRESHOLD,
            windowMs: EMPTY_OUTPUT_WINDOW_MS,
            occurrences,
          },
        }),
      })
    }
  }

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

function countRecentOccurrences(
  input: IncidentRuleInput,
  code: string,
  dedupeKey: string,
): number {
  const cutoff = input.nowMs - EMPTY_OUTPUT_WINDOW_MS
  const history = [...input.recent, input.incoming]
  return history.filter((event) => {
    if (event.code !== code) {
      return false
    }
    if (EventDedupeKeySchema.parse(event) !== dedupeKey) {
      return false
    }
    return event.occurredAt >= cutoff
  }).length
}

function isErrorSeverity(severity: ObservabilitySeverity): boolean {
  return severity === 'error' || severity === 'fatal'
}
