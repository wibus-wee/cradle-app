import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import pc from 'picocolors'
import pino from 'pino'

import type { LogLevel } from '../config/server-config'
import { getActiveLogTraceFields } from '../telemetry/spans'

export interface LoggerFields {
  [key: string]: unknown
}

interface FlushableDestination extends pino.DestinationStream {
  flush?: () => void
  flushSync?: () => void
}

const fileDestinations: FlushableDestination[] = []

/* ------------------------------------------------------------------ */
/*  Pretty-print stream for TUI / terminal stdout                     */
/* ------------------------------------------------------------------ */

const LEVEL_STYLE: Record<string, (s: string) => string> = {
  fatal: s => pc.bgRed(pc.white(pc.bold(s))),
  error: s => pc.red(pc.bold(s)),
  warn: s => pc.yellow(pc.bold(s)),
  info: s => pc.green(s),
  debug: s => pc.gray(s),
  trace: s => pc.dim(pc.gray(s)),
}

function styleLevel(label: string): string {
  const styler = LEVEL_STYLE[label]
  return styler ? styler(label) : label
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return pc.dim(
    `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`,
  )
}

function formatFields(fields: Record<string, unknown>): string {
  const skip = new Set(['level', 'time', 'msg'])
  const entries = Object.entries(fields).filter(([k]) => !skip.has(k))
  if (entries.length === 0) { return '' }
  const pairs = entries.map(([k, v]) => {
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return `${pc.cyan(k)}=${val}`
  })
  return ` ${pairs.join(' ')}`
}

function isBrokenPipeError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && ((error as { code?: unknown }).code === 'EPIPE'
      || (error as { code?: unknown }).code === 'ERR_STREAM_DESTROYED')
  )
}

function writeTerminalStream(stream: { write: (chunk: string) => unknown }, chunk: string): void {
  try {
    stream.write(chunk)
  }
  catch (error) {
    if (!isBrokenPipeError(error)) {
      throw error
    }
  }
}

const prettyStream: pino.StreamEntry = {
  level: 'trace',
  stream: {
    write(chunk: string) {
      let output = chunk
      try {
        const obj = JSON.parse(chunk) as Record<string, unknown>
        const label = String(obj.level ?? 'info')
        const msg = String(obj.msg ?? '')
        const ts = obj.time ? formatTimestamp(String(obj.time)) : pc.dim('--:--:--')
        const context = obj.module ? pc.magenta(`[${String(obj.module)}]`) : ''
        const fields = formatFields(obj)

        output = `${ts} ${styleLevel(label)} ${context}${pc.reset(' ')}${msg}${fields}\n`
      }
      catch {
        // Not JSON - write raw.
      }
      writeTerminalStream(process.stdout, output)
    },
  },
}

/* ------------------------------------------------------------------ */
/*  Stream setup                                                       */
/* ------------------------------------------------------------------ */

function resolveLogFile(): string | null {
  const file = process.env.CRADLE_LOG_FILE?.trim()
  if (file) {
    return file
  }
  const dataDir = process.env.CRADLE_DATA_DIR?.trim()
  if (dataDir) {
    return `${dataDir}/server.log`
  }
  return null
}

function createStreams() {
  const level = ((process.env.CRADLE_LOG_LEVEL as string) || 'info') as pino.Level
  const streams: pino.StreamEntry[] = [
    { level, stream: prettyStream.stream },
  ]
  const logFile = resolveLogFile()
  if (logFile) {
    try {
      mkdirSync(dirname(logFile), { recursive: true })
    }
    catch { /* ignore */ }
    const dest = pino.destination({ dest: logFile, sync: process.env.CRADLE_LOG_SYNC === '1' })
    fileDestinations.push(dest)
    streams.push({ level, stream: dest })
    writeTerminalStream(process.stderr, `[logger] file logging enabled: ${logFile}\n`)
  }
  return streams
}

let rootLogger: pino.Logger | undefined

function createRootLogger(): pino.Logger {
  return pino({
    level: (process.env.CRADLE_LOG_LEVEL as LogLevel) || 'info',
    serializers: {
      err: pino.stdSerializers.err,
    },
    formatters: {
      level(label) {
        return { level: label }
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  }, pino.multistream(createStreams()))
}

function getRootLogger(): pino.Logger {
  rootLogger ??= createRootLogger()
  return rootLogger
}

export function initializeLogger(): void {
  getRootLogger()
}

/**
 * Logger wraps pino with a stable interface compatible with the existing codebase.
 * Supports both class-based usage (MigrationRunner) and direct function calls.
 *
 * Output:
 * - stdout: NestJS-style pretty-printed with picocolors (human-readable in TUI)
 * - file:   raw JSON (machine-parseable)
 */
export class Logger {
  private readonly instance?: pino.Logger
  private readonly bindings?: LoggerFields

  constructor(instance?: pino.Logger, bindings?: LoggerFields) {
    this.instance = instance
    this.bindings = bindings
  }

  private get active(): pino.Logger {
    const logger = this.instance ?? getRootLogger()
    return this.bindings ? logger.child(this.bindings) : logger
  }

  debug(message: string, fields?: LoggerFields): void {
    const merged = mergeTraceFields(fields)
    if (merged) { this.active.debug(merged, message) }
    else { this.active.debug(message) }
  }

  info(message: string, fields?: LoggerFields): void {
    const merged = mergeTraceFields(fields)
    if (merged) { this.active.info(merged, message) }
    else { this.active.info(message) }
  }

  warn(message: string, fields?: LoggerFields): void {
    const merged = mergeTraceFields(fields)
    if (merged) { this.active.warn(merged, message) }
    else { this.active.warn(message) }
  }

  error(message: string, fields?: LoggerFields): void {
    const merged = mergeTraceFields(fields)
    if (merged) { this.active.error(merged, message) }
    else { this.active.error(message) }
  }

  child(bindings: LoggerFields): Logger {
    return new Logger(this.instance, { ...this.bindings, ...bindings })
  }

  /** Access the underlying pino instance for advanced usage. */
  get pino(): pino.Logger {
    return this.active
  }
}

/** Return the root pino-based Logger instance. */
export function getLogger(): Logger {
  return new Logger(getRootLogger())
}

/** Create a child logger with bound context (e.g. requestId, module). */
export function createChildLogger(bindings: LoggerFields): Logger {
  return rootLogger ? new Logger(rootLogger.child(bindings)) : new Logger(undefined, bindings)
}

function mergeTraceFields(fields?: LoggerFields): LoggerFields | undefined {
  const traceFields = getActiveLogTraceFields()
  if (!traceFields) {
    return fields
  }
  return fields ? { ...traceFields, ...fields } : traceFields
}

/** Flush buffered log destinations before intentional process exits. */
export function flushLogger(): void {
  try {
    rootLogger?.flush()
  }
  catch {
    // Logging flush is best-effort during process shutdown.
  }
  for (const dest of fileDestinations) {
    try {
      dest.flush?.()
      dest.flushSync?.()
    }
    catch {
      // SonicBoom can reject synchronous flush before the destination is ready.
    }
  }
}
