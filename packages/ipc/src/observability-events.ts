export type ObservabilitySeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export type ObservabilityCategory = 'chat' | 'provider' | 'event-bus' | 'ipc' | 'system' | 'performance' | 'diagnostics'

export type ObservabilitySource = 'chat-engine' | 'domain-event-bus' | 'ipc' | 'provider' | 'renderer' | 'http' | 'desktop-main' | 'server'

export interface ObservabilityEvent {
  id: string
  schemaVersion: number
  source: ObservabilitySource
  code: string
  severity: ObservabilitySeverity
  category: ObservabilityCategory
  message: string
  attrs?: Record<string, unknown>
  chatSessionId?: string
  runId?: string
  messageId?: string
  traceId?: string
  dedupeKey?: string
  parentEventId?: string
  occurredAt: number
  recordedAt: number
}

export interface ObservabilityIncident {
  id: string
  dedupeKey: string
  code: string
  severity: ObservabilitySeverity
  status: 'open' | 'resolved'
  source: ObservabilitySource
  message: string
  chatSessionId?: string
  runId?: string
  messageId?: string
  firstOccurredAt: number
  lastOccurredAt: number
  lastRecordedAt: number
  count: number
  lastEventId?: string
  attrs?: Record<string, unknown>
}

export type ObservabilityDevtoolEvent
  = { kind: 'event', payload: ObservabilityEvent }
    | { kind: 'incident', payload: ObservabilityIncident }
