import { Worker } from 'node:worker_threads'

import { WORKER_SHIM_SOURCE } from './shim'

export const MAX_PROGRAM_BYTES = 64 * 1024
export const EXEC_MAX_OUTPUT_BYTES = 256 * 1024
export const EVAL_DEFAULT_TIMEOUT_MS = 30_000
export const EVAL_MAX_TIMEOUT_MS = 120_000
export const EXEC_DEFAULT_TIMEOUT_MS = 30_000
export const WORKER_MAX_OLD_SPACE_MB = 128

export interface EvaluateCellInput {
  program: string
  mode?: 'check' | 'run'
  cwd?: string
  timeoutMs?: number
}

export type EvaluateCellResult
  = | { kind: 'completed', result: unknown }
    | { kind: 'check-passed' }
    | { kind: 'error', error: string }
    | { kind: 'timeout' }
    | { kind: 'crashed', error: string }

interface WorkerReply {
  ok: boolean
  result?: unknown
  error?: string
}

export async function evaluateCell(input: EvaluateCellInput): Promise<EvaluateCellResult> {
  const mode = input.mode ?? 'run'
  const timeoutMs = input.timeoutMs ?? EVAL_DEFAULT_TIMEOUT_MS
  const worker = new Worker(WORKER_SHIM_SOURCE, {
    eval: true,
    workerData: {
      program: input.program,
      mode,
      cwd: input.cwd,
      execTimeoutMs: EXEC_DEFAULT_TIMEOUT_MS,
    },
    resourceLimits: {
      maxOldGenerationSizeMb: WORKER_MAX_OLD_SPACE_MB,
      maxYoungGenerationSizeMb: 16,
    },
    env: process.env,
  })

  try {
    return await new Promise<EvaluateCellResult>((resolve) => {
      let settled = false
      const settle = (result: EvaluateCellResult) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        settle({ kind: 'timeout' })
      }, timeoutMs)
      worker.once('message', (reply: WorkerReply) => {
        if (reply.ok) {
          settle(mode === 'check' ? { kind: 'check-passed' } : { kind: 'completed', result: reply.result })
        }
        else {
          settle({ kind: 'error', error: reply.error ?? 'Cell evaluation failed without an error message' })
        }
      })
      worker.once('error', (err: Error) => {
        settle({ kind: 'crashed', error: err.message })
      })
    })
  }
  finally {
    await worker.terminate()
  }
}
