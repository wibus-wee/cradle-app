import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { getHeapSnapshot } from 'node:v8'

import { AppError } from '../../errors/app-error'
import { getServerConfig } from '../../infra'
import { getTelemetryConfig } from '../../telemetry/config'
import { OBSERVABILITY_CODES } from './contract'
import { record } from './service'

export interface HeapSnapshotInput {
  token?: string
}

export interface HeapSnapshotContext {
  request: Request
}

function isLocalRequest(request: Request): boolean {
  const url = new URL(request.url)
  return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
}

function assertDiagnosticsAllowed(input: HeapSnapshotInput, context: HeapSnapshotContext): void {
  if (!getTelemetryConfig().diagnosticsEnabled) {
    throw new AppError({
      code: 'diagnostics_disabled',
      status: 404,
      message: 'Diagnostics endpoints are disabled',
    })
  }
  if (!isLocalRequest(context.request)) {
    throw new AppError({
      code: 'diagnostics_forbidden',
      status: 403,
      message: 'Diagnostics endpoints only accept local requests',
    })
  }

  const expectedToken = process.env.CRADLE_DIAGNOSTICS_TOKEN?.trim()
  if (!expectedToken) {
    return
  }
  const providedToken = input.token ?? context.request.headers.get('x-cradle-diagnostics-token') ?? undefined
  if (providedToken !== expectedToken) {
    throw new AppError({
      code: 'diagnostics_forbidden',
      status: 403,
      message: 'Diagnostics token is invalid',
    })
  }
}

function resolveDiagnosticsRoot(): string {
  const config = getServerConfig()
  return resolve(config.dataDir ?? dirname(config.dbPath), 'diagnostics', 'heap-snapshots')
}

export async function writeHeapSnapshot(input: HeapSnapshotInput, context: HeapSnapshotContext) {
  assertDiagnosticsAllowed(input, context)

  const root = resolveDiagnosticsRoot()
  mkdirSync(root, { recursive: true })
  const startedAt = Date.now()
  const fileName = `heap-${process.pid}-${startedAt}.heapsnapshot`
  const path = join(root, fileName)

  try {
    await pipeline(getHeapSnapshot(), createWriteStream(path, { flags: 'wx' }))
    const completedAt = Date.now()
    record({
      source: 'server',
      code: OBSERVABILITY_CODES.diagnosticsHeapSnapshotWritten,
      severity: 'warn',
      category: 'system',
      message: 'Heap snapshot written',
      attrs: {
        pid: process.pid,
        path,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
      },
    })
    return {
      ok: true as const,
      path,
      pid: process.pid,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
    }
  }
  catch (error) {
    record({
      source: 'server',
      code: OBSERVABILITY_CODES.diagnosticsHeapSnapshotFailed,
      severity: 'error',
      category: 'system',
      message: 'Heap snapshot failed',
      attrs: {
        pid: process.pid,
        path,
        startedAt,
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { value: String(error) },
      },
    })
    throw error
  }
}
