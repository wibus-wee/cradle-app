import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

import { redactDiagnosticText } from './diagnostic-envelope.mjs'

export interface M0LifecycleContext {
  mode: string | null
  resultPath: string | null
  artifactPath: string | null
}

export interface M0LifecycleRecorder {
  record: (checkpoint: string, details?: Record<string, boolean | number | string | null>) => void
}

export function createM0LifecycleRecorder(path: string | undefined, context: M0LifecycleContext): M0LifecycleRecorder {
  if (!path || !isAbsolute(path)) {
    throw new Error('CRADLE_M0_LIFECYCLE_PATH must be absolute')
  }
  mkdirSync(dirname(path), { recursive: true })
  let sequence = 0

  return {
    record(checkpoint, details = {}) {
      sequence += 1
      const sanitizedDetails = Object.fromEntries(
        Object.entries(details).map(([key, value]) => [
          key,
          typeof value === 'string' ? redactDiagnosticText(value) : value,
        ]),
      )
      const record = {
        schemaVersion: 1,
        kind: 'm0-main-lifecycle',
        sequence,
        timestamp: new Date().toISOString(),
        checkpoint: redactDiagnosticText(checkpoint),
        pid: process.pid,
        platform: process.platform,
        arch: process.arch,
        mode: context.mode === null ? null : redactDiagnosticText(context.mode),
        resultPath: context.resultPath === null ? null : redactDiagnosticText(context.resultPath),
        artifactPath: context.artifactPath === null ? null : redactDiagnosticText(context.artifactPath),
        details: sanitizedDetails,
      }
      appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
    },
  }
}
