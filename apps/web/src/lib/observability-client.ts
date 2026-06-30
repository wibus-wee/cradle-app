import { getServerUrl, isElectron, platform } from './electron'

type ObservabilitySeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal'
type ObservabilityCategory = 'chat' | 'provider' | 'event-bus' | 'ipc' | 'system' | 'performance' | 'diagnostics'

interface RendererObservabilityEventInput {
  code: string
  severity: ObservabilitySeverity
  category: ObservabilityCategory
  message: string
  attrs?: Record<string, unknown>
  dedupeKey?: string
  occurredAt?: number
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return { value: String(error) }
}

function readLocation(): Record<string, unknown> {
  return {
    href: window.location.href,
    hash: window.location.hash,
    pathname: window.location.pathname,
  }
}

export function reportRendererObservabilityEvent(input: RendererObservabilityEventInput): void {
  const payload = {
    source: 'renderer',
    ...input,
    attrs: {
      ...input.attrs,
      renderer: {
        electron: isElectron,
        platform,
        userAgent: navigator.userAgent,
        location: readLocation(),
      },
    },
  }

  void fetch(new URL('/observability/events', getServerUrl()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {})
}

export function reportRendererError(input: {
  code: string
  message: string
  error: unknown
  severity?: ObservabilitySeverity
  attrs?: Record<string, unknown>
}): void {
  reportRendererObservabilityEvent({
    code: input.code,
    severity: input.severity ?? 'error',
    category: 'system',
    message: input.message,
    attrs: {
      ...input.attrs,
      error: serializeError(input.error),
    },
  })
}
