import { app, BrowserWindow } from 'electron'

interface DesktopObservabilityEvent {
  source: 'desktop-main'
  code: string
  severity: 'error' | 'fatal'
  category: 'system'
  message: string
  attrs: Record<string, unknown>
  occurredAt: number
}

let serverUrl: string | null = null
const pendingEvents: DesktopObservabilityEvent[] = []
let resourceReporterTimer: NodeJS.Timeout | null = null
let resourceReporterInFlight = false
let runtimeDiagnosticsProvider: DesktopRuntimeDiagnosticsProvider | null = null

interface DesktopRuntimeSample {
  source: 'desktop-main'
  sampledAt: number
  main: Record<string, unknown>
  appMetrics: Array<Record<string, unknown>>
  windows: Array<Record<string, unknown>>
  diagnostics?: Record<string, unknown>
}

type DesktopRuntimeDiagnosticsProvider
  = () => Record<string, unknown> | Promise<Record<string, unknown>>

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

function createEvent(code: string, message: string, error: unknown): DesktopObservabilityEvent {
  return {
    source: 'desktop-main',
    code,
    severity: 'fatal',
    category: 'system',
    message,
    attrs: {
      error: serializeError(error),
      desktop: {
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
      },
    },
    occurredAt: Date.now(),
  }
}

async function sendEvent(event: DesktopObservabilityEvent): Promise<void> {
  if (!serverUrl) {
    pendingEvents.push(event)
    return
  }
  await fetch(new URL('/observability/events', serverUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  })
}

async function readRuntimeDiagnostics(): Promise<Record<string, unknown> | undefined> {
  if (!runtimeDiagnosticsProvider) {
    return undefined
  }

  try {
    return await runtimeDiagnosticsProvider()
  }
  catch (error) {
    return {
      runtimeDiagnosticsError: serializeError(error),
    }
  }
}

async function createRuntimeSample(): Promise<DesktopRuntimeSample> {
  const memory = await process.getProcessMemoryInfo()
  const diagnostics = await readRuntimeDiagnostics()
  const sample: DesktopRuntimeSample = {
    source: 'desktop-main',
    sampledAt: Date.now(),
    main: {
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      memory,
    },
    appMetrics: app.getAppMetrics().map(metric => ({
      pid: metric.pid,
      type: metric.type,
      cpu: metric.cpu,
      creationTime: metric.creationTime,
      memory: metric.memory,
      sandboxed: metric.sandboxed,
      integrityLevel: metric.integrityLevel,
    })),
    windows: BrowserWindow.getAllWindows().map((window) => {
      const webContents = window.webContents
      return {
        id: window.id,
        title: window.getTitle(),
        visible: window.isVisible(),
        destroyed: window.isDestroyed(),
        webContentsId: webContents.id,
        rendererProcessId: webContents.getOSProcessId(),
        url: webContents.getURL(),
      }
    }),
  }
  if (diagnostics) {
    sample.diagnostics = diagnostics
  }
  return sample
}

async function sendRuntimeSample(sample: DesktopRuntimeSample): Promise<void> {
  if (!serverUrl) {
    return
  }
  await fetch(new URL('/observability/runtime-samples', serverUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sample),
  })
}

function reportRuntimeSample(): void {
  if (resourceReporterInFlight) {
    return
  }
  resourceReporterInFlight = true
  void createRuntimeSample()
    .then(sendRuntimeSample)
    .catch(() => {
      // Runtime samples are diagnostic and intentionally dropped when unavailable.
    })
    .finally(() => {
      resourceReporterInFlight = false
    })
}

function reportEvent(event: DesktopObservabilityEvent): void {
  void sendEvent(event).catch(() => {
    pendingEvents.push(event)
  })
}

export function bindDesktopObservabilityServerUrl(url: string): void {
  serverUrl = url
  const events = pendingEvents.splice(0)
  for (const event of events) {
    void sendEvent(event).catch(() => {
      pendingEvents.push(event)
    })
  }
  reportRuntimeSample()
}

export function setDesktopRuntimeDiagnosticsProvider(
  provider: DesktopRuntimeDiagnosticsProvider | null,
): void {
  runtimeDiagnosticsProvider = provider
}

export function startDesktopResourceReporting(intervalMs = 10_000): void {
  if (resourceReporterTimer) {
    return
  }
  reportRuntimeSample()
  resourceReporterTimer = setInterval(reportRuntimeSample, intervalMs)
  resourceReporterTimer.unref?.()
}

export function stopDesktopResourceReporting(): void {
  if (!resourceReporterTimer) {
    return
  }
  clearInterval(resourceReporterTimer)
  resourceReporterTimer = null
}

export function installDesktopMainErrorCapture(): void {
  process.on('uncaughtException', (error) => {
    console.error('[desktop] uncaught exception:', error)
    reportEvent(createEvent('DESKTOP_MAIN_UNCAUGHT_EXCEPTION', 'Desktop main uncaught exception', error))
  })

  process.on('unhandledRejection', (reason) => {
    console.error('[desktop] unhandled rejection:', reason)
    reportEvent(createEvent('DESKTOP_MAIN_UNHANDLED_REJECTION', 'Desktop main unhandled promise rejection', reason))
  })
}
