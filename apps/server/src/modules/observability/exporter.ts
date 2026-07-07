import { existsSync, readFileSync } from 'node:fs'
import { arch, cpus, freemem, platform, release, totalmem, type as osType } from 'node:os'
import { join } from 'node:path'

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type { ObservabilityEvent, ObservabilityIncident } from './contract'

export interface ExportObservabilityBundleInput {
  chatSessionId?: string
  runId?: string
  sinceUnix?: number
}

export interface ObservabilityBundle {
  schema: string
  exportedAt: number
  metadata: Record<string, unknown>
  redaction: Record<string, unknown>
  events: ObservabilityEvent[]
  incidents: ObservabilityIncident[]
  errorPatterns: ObservabilityBundleErrorPattern[]
  timeline: Array<Record<string, unknown>>
  logs: Record<string, unknown>
}

export interface ObservabilityBundleErrorPattern {
  patternId: string
  source: string
  code: string
  category: string
  severity: string
  runtimeKind?: string
  providerTargetId?: string
  modelId?: string
  messageFingerprint: string
  messagePreview: string
  count: number
  firstSeenAt: number
  lastSeenAt: number
  sampleRunIds: string[]
  sampleTraceIds: string[]
  sampleMessages: string[]
}

const MAX_LOG_BYTES = 128 * 1024
const SECRET_PATTERNS: Array<{ pattern: RegExp, replacement: string }> = [
  { pattern: /sk-[\w-]{12,}/g, replacement: '[REDACTED]' },
  { pattern: /(api[_-]?key\s*["':=]\s*)[^"',\s]+/gi, replacement: '$1[REDACTED]' },
  { pattern: /(token\s*["':=]\s*)[^"',\s]+/gi, replacement: '$1[REDACTED]' },
  { pattern: /(authorization["'\s:=]+bearer\s+)[^"',\s]+/gi, replacement: '$1[REDACTED]' },
]

export function exportObservabilityBundle(
  input: ExportObservabilityBundleInput,
  deps: {
    db: BetterSQLite3Database<Record<string, unknown>>
    queryEvents: (filter: { chatSessionId?: string, runId?: string, since?: number, limit?: number }) => ObservabilityEvent[]
    queryIncidents: (filter: { chatSessionId?: string, runId?: string, limit?: number }) => ObservabilityIncident[]
    queryErrorPatterns: (filter: { chatSessionId?: string, runId?: string, sinceUnix?: number, limit?: number }) => ObservabilityBundleErrorPattern[]
    queryTimeline: (filter: { chatSessionId?: string, runId?: string, since?: number, limit?: number }) => Array<Record<string, unknown>>
  },
): ObservabilityBundle {
  const exportedAt = Date.now()
  const events = deps.queryEvents({
    chatSessionId: input.chatSessionId,
    runId: input.runId,
    since: input.sinceUnix === undefined ? undefined : input.sinceUnix * 1000,
    limit: 10000,
  })

  const incidents = deps.queryIncidents({
    chatSessionId: input.chatSessionId,
    runId: input.runId,
    limit: 2000,
  })
  const errorPatterns = deps.queryErrorPatterns({
    chatSessionId: input.chatSessionId,
    runId: input.runId,
    sinceUnix: input.sinceUnix,
    limit: 500,
  })
  const timeline = deps.queryTimeline({
    chatSessionId: input.chatSessionId,
    runId: input.runId,
    since: input.sinceUnix === undefined ? undefined : input.sinceUnix * 1000,
    limit: 200,
  })
  const redaction = createRedactionSummary()
  const logBundle = readServerLogTail(redaction)

  return {
    schema: 'cradle.diagnostics.bundle.v1',
    exportedAt,
    metadata: createMetadata(exportedAt, input),
    redaction,
    events: redactJson(events, redaction) as ObservabilityEvent[],
    incidents: redactJson(incidents, redaction) as ObservabilityIncident[],
    errorPatterns: redactJson(errorPatterns, redaction) as ObservabilityBundleErrorPattern[],
    timeline: redactJson(timeline, redaction) as Array<Record<string, unknown>>,
    logs: logBundle,
  }
}

function createMetadata(exportedAt: number, input: ExportObservabilityBundleInput): Record<string, unknown> {
  return {
    exportedAtIso: new Date(exportedAt).toISOString(),
    app: {
      version: process.env.npm_package_version ?? process.env.CRADLE_VERSION ?? '0.0.1',
      nodeEnv: process.env.NODE_ENV ?? null,
    },
    server: {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      dataDir: redactString(process.env.CRADLE_DATA_DIR ?? null),
      logFile: redactString(resolveLogFile()),
      host: process.env.CRADLE_HOST ?? '127.0.0.1',
      port: process.env.CRADLE_PORT ?? null,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      versions: process.versions,
    },
    os: {
      type: osType(),
      platform: platform(),
      release: release(),
      arch: arch(),
      cpuCount: cpus().length,
      totalMemory: totalmem(),
      freeMemory: freemem(),
    },
    filters: {
      chatSessionId: inputOrNull('chatSessionId'),
      runId: inputOrNull('runId'),
      sinceUnix: inputOrNull('sinceUnix'),
    },
  }

  function inputOrNull(key: keyof ExportObservabilityBundleInput): string | number | null {
    return input[key] ?? null
  }
}

function createRedactionSummary(): Record<string, unknown> {
  return {
    applied: true,
    version: 1,
    notes: [
      'Home directory paths are replaced with ~.',
      'Common API key, token, and bearer credential patterns are replaced with [REDACTED].',
      'Diagnostics remain local until the user shares them manually.',
    ],
  }
}

function resolveLogFile(): string | null {
  const explicit = process.env.CRADLE_LOG_FILE?.trim()
  if (explicit) {
    return explicit
  }
  const dataDir = process.env.CRADLE_DATA_DIR?.trim()
  if (dataDir) {
    return join(dataDir, 'server.log')
  }
  return null
}

function readServerLogTail(redaction: Record<string, unknown>): Record<string, unknown> {
  const logFile = resolveLogFile()
  if (!logFile || !existsSync(logFile)) {
    return {
      serverLog: {
        path: redactString(logFile),
        available: false,
        tail: '',
        maxBytes: MAX_LOG_BYTES,
        redaction,
      },
    }
  }

  const raw = readFileSync(logFile)
  const tail = raw.subarray(Math.max(0, raw.length - MAX_LOG_BYTES)).toString('utf8')
  return {
    serverLog: {
      path: redactString(logFile),
      available: true,
      byteLength: raw.length,
      truncatedToLastBytes: raw.length > MAX_LOG_BYTES ? MAX_LOG_BYTES : raw.length,
      tail: redactString(tail),
      redaction,
    },
  }
}

function redactJson(value: unknown, redaction: Record<string, unknown>): unknown {
  void redaction
  if (typeof value === 'string') {
    return redactString(value)
  }
  if (Array.isArray(value)) {
    return value.map(item => redactJson(item, redaction))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactJson(child, redaction)]),
    )
  }
  return value
}

function redactString(value: string | null): string | null {
  if (value === null) {
    return null
  }
  let next = value
  const home = process.env.HOME
  if (home) {
    next = next.split(home).join('~')
  }
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    next = next.replace(pattern, replacement)
  }
  return next
}
