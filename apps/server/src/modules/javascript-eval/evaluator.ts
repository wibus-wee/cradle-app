import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawnManagedProcess } from '../../infra/managed-process'
import { normalizeJavaScriptCellProgram } from './program'

export const MAX_PROGRAM_BYTES = 64 * 1024
export const EXEC_MAX_OUTPUT_BYTES = 256 * 1024
export const EVAL_DEFAULT_TIMEOUT_MS = 30_000
export const EVAL_MAX_TIMEOUT_MS = 120_000
export const EXEC_DEFAULT_TIMEOUT_MS = 30_000
export const EVALUATOR_MAX_OLD_SPACE_MB = 128
export const MAX_EVALUATOR_RESULT_BYTES = 1024 * 1024

const STDERR_MAX_BYTES = 1024 * 1024
const localModuleDir = dirname(fileURLToPath(import.meta.url))

export interface EvaluateCellInput {
  program: string
  mode?: 'check' | 'run'
  cwd?: string
  timeoutMs?: number
}

export type EvaluateCellResult
  = | { kind: 'completed', result: unknown }
    | { kind: 'check-passed' }
    | { kind: 'program-error', error: string }
    | { kind: 'execution-error', error: string }
    | { kind: 'timeout' }
    | { kind: 'crashed', error: string }

type RunnerReply
  = | { kind: 'completed', result?: unknown }
    | { kind: 'program-error', error: string }
    | { kind: 'execution-error', error: string }

interface ManagedExecutionResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stderr: string
  timedOut: boolean
}

function resolveEvaluatorRunnerPath(): string {
  const sourceCandidate = resolve(localModuleDir, 'runner.ts')
  const builtCandidates = [
    resolve(localModuleDir, 'javascript-eval-runner.js'),
    resolve(dirname(localModuleDir), 'javascript-eval-runner.js'),
  ]
  const candidates = localModuleDir.endsWith('/src/modules/javascript-eval') || localModuleDir.endsWith('\\src\\modules\\javascript-eval')
    ? [sourceCandidate]
    : builtCandidates
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]!
}

function appendAtByteLimit(current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> {
  if (current.byteLength >= STDERR_MAX_BYTES) {
    return current
  }
  const remaining = STDERR_MAX_BYTES - current.byteLength
  return Buffer.concat([current, chunk.subarray(0, remaining)])
}

async function runManagedNode(input: {
  args: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  stdin: string
  timeoutMs: number
}): Promise<ManagedExecutionResult> {
  const child = spawnManagedProcess({
    kind: 'spawn',
    command: process.execPath,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    stdin: 'pipe',
  })
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  child.stderr?.on('data', (chunk: Buffer<ArrayBufferLike>) => {
    stderr = appendAtByteLimit(stderr, chunk)
  })

  return await new Promise((resolveExecution) => {
    let settled = false
    let timedOut = false
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolveExecution({
        exitCode,
        signal,
        stderr: stderr.toString('utf8'),
        timedOut,
      })
    }
    const timer = setTimeout(() => {
      timedOut = true
      void child.stop().catch(() => {}).finally(() => finish(child.exitCode, child.signalCode))
    }, input.timeoutMs)

    child.once('close', finish)
    child.once('error', () => finish(null, null))
    child.stdin?.on('error', () => {})
    child.stdin?.end(input.stdin)
  })
}

function readCrashError(execution: ManagedExecutionResult): string {
  const stderr = execution.stderr.trim()
  if (stderr) {
    return stderr
  }
  if (execution.signal) {
    return `Evaluator process exited from signal ${execution.signal}.`
  }
  return `Evaluator process exited with code ${execution.exitCode ?? 'unknown'} without a result.`
}

async function checkProgram(program: string, timeoutMs: number): Promise<EvaluateCellResult> {
  const execution = await runManagedNode({
    args: ['--input-type=module', '--check'],
    stdin: program,
    timeoutMs,
  })
  if (execution.timedOut) {
    return { kind: 'timeout' }
  }
  if (execution.exitCode === 0) {
    return { kind: 'check-passed' }
  }
  return { kind: 'program-error', error: readCrashError(execution) }
}

function buildRunnerArgs(runnerPath: string): string[] {
  const args = [`--max-old-space-size=${EVALUATOR_MAX_OLD_SPACE_MB}`]
  // Source-mode tests/dev resolve runner.ts; plain node needs type stripping.
  if (runnerPath.endsWith('.ts')) {
    args.push('--experimental-strip-types', '--no-warnings')
  }
  args.push(runnerPath)
  return args
}

async function runProgram(program: string, input: EvaluateCellInput, timeoutMs: number): Promise<EvaluateCellResult> {
  const tempDir = await mkdtemp(join(tmpdir(), 'cradle-javascript-eval-'))
  const resultPath = join(tempDir, 'result.json')
  try {
    const execution = await runManagedNode({
      args: buildRunnerArgs(resolveEvaluatorRunnerPath()),
      cwd: input.cwd,
      env: { CRADLE_JAVASCRIPT_EVAL_RESULT_PATH: resultPath },
      stdin: JSON.stringify({ program, execTimeoutMs: EXEC_DEFAULT_TIMEOUT_MS }),
      timeoutMs,
    })
    if (execution.timedOut) {
      return { kind: 'timeout' }
    }

    let reply: RunnerReply
    try {
      const resultFile = await stat(resultPath)
      if (resultFile.size > MAX_EVALUATOR_RESULT_BYTES) {
        return { kind: 'crashed', error: 'Evaluator process returned an oversized protocol result.' }
      }
      reply = JSON.parse(await readFile(resultPath, 'utf8')) as RunnerReply
    }
    catch {
      return { kind: 'crashed', error: readCrashError(execution) }
    }

    if (reply.kind === 'completed') {
      return { kind: 'completed', result: reply.result }
    }
    if (reply.kind === 'program-error' || reply.kind === 'execution-error') {
      return reply
    }
    return { kind: 'crashed', error: 'Evaluator process returned an invalid protocol result.' }
  }
  finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function evaluateCell(input: EvaluateCellInput): Promise<EvaluateCellResult> {
  if (Buffer.byteLength(input.program, 'utf8') > MAX_PROGRAM_BYTES) {
    return { kind: 'program-error', error: `JavaScript program exceeds the ${MAX_PROGRAM_BYTES} byte limit.` }
  }

  let program: string
  try {
    program = await normalizeJavaScriptCellProgram(input.program)
  }
  catch (error) {
    return { kind: 'program-error', error: error instanceof Error ? error.message : String(error) }
  }

  const timeoutMs = input.timeoutMs ?? EVAL_DEFAULT_TIMEOUT_MS
  return input.mode === 'check'
    ? checkProgram(program, timeoutMs)
    : runProgram(program, input, timeoutMs)
}
