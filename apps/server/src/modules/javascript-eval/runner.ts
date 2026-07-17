import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const EXEC_MAX_OUTPUT_BYTES = 256 * 1024
const MAX_EVALUATOR_RESULT_BYTES = 1024 * 1024
const TRUNCATED_OUTPUT_MARKER = '…[truncated]'
const resultPath = process.env.CRADLE_JAVASCRIPT_EVAL_RESULT_PATH

interface RunnerInput {
  program: string
  execTimeoutMs: number
}

type RunnerReply
  = | { kind: 'completed', result?: unknown }
    | { kind: 'program-error', error: string }
    | { kind: 'execution-error', error: string }

interface ExecRequest {
  argv: string[]
  cwd?: string
}

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

function readErrorMessage(error: Error): string {
  return error.message
}

function truncateUtf8(text: string, forceMarker = false): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.byteLength < EXEC_MAX_OUTPUT_BYTES || (bytes.byteLength === EXEC_MAX_OUTPUT_BYTES && !forceMarker)) {
    return text
  }
  return `${bytes.subarray(0, EXEC_MAX_OUTPUT_BYTES).toString('utf8')}${TRUNCATED_OUTPUT_MARKER}`
}

function execute(request: ExecRequest, execTimeoutMs: number): Promise<ExecResult> {
  if (!Array.isArray(request.argv) || request.argv.length === 0 || request.argv.some(arg => typeof arg !== 'string')) {
    return Promise.reject(new Error('tools.exec requires argv to be a non-empty array of strings.'))
  }

  return new Promise((resolve, reject) => {
    execFile(request.argv[0], request.argv.slice(1), {
      cwd: request.cwd ?? process.cwd(),
      encoding: 'utf8',
      maxBuffer: EXEC_MAX_OUTPUT_BYTES,
      timeout: execTimeoutMs,
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ exitCode: 0, stdout: truncateUtf8(stdout), stderr: truncateUtf8(stderr) })
        return
      }
      if (error.killed) {
        reject(new Error(`Command timed out after ${execTimeoutMs} ms and was killed.`))
        return
      }
      if (typeof error.code === 'number') {
        resolve({ exitCode: error.code, stdout: truncateUtf8(stdout), stderr: truncateUtf8(stderr) })
        return
      }
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        resolve({ exitCode: 1, stdout: truncateUtf8(stdout, true), stderr: truncateUtf8(stderr, true) })
        return
      }
      reject(new Error(`Command could not be executed: ${error.message}`))
    })
  })
}

async function readInput(): Promise<RunnerInput> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RunnerInput
}

async function writeReply(reply: RunnerReply): Promise<void> {
  if (!resultPath) {
    throw new Error('CRADLE_JAVASCRIPT_EVAL_RESULT_PATH is required')
  }
  let serialized = JSON.stringify(reply)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_EVALUATOR_RESULT_BYTES) {
    serialized = JSON.stringify({
      kind: 'execution-error',
      error: `Cell result exceeds the ${MAX_EVALUATOR_RESULT_BYTES} byte limit.`,
    } satisfies RunnerReply)
  }
  await writeFile(resultPath, serialized, 'utf8')
}

async function main(): Promise<void> {
  const input = await readInput()
  const executeTool = (request: ExecRequest) => execute(request, input.execTimeoutMs)

  let cell: ((context: { cwd: string, tools: { exec: typeof executeTool } }) => Promise<unknown>)
  try {
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(input.program, 'utf8').toString('base64')}`
    const module = await import(moduleUrl)
    if (typeof module.default !== 'function') {
      await writeReply({ kind: 'program-error', error: 'Program must export a default function.' })
      return
    }
    cell = module.default
  }
  catch (error) {
    await writeReply({
      kind: 'program-error',
      error: readErrorMessage(error instanceof Error ? error : new Error(String(error))),
    })
    return
  }

  try {
    const result = await cell({ cwd: process.cwd(), tools: { exec: executeTool } })
    structuredClone(result)
    await writeReply({ kind: 'completed', result })
  }
  catch (error) {
    await writeReply({
      kind: 'execution-error',
      error: readErrorMessage(error instanceof Error ? error : new Error(String(error))),
    })
  }
}

void main()
