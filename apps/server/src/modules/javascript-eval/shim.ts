// Worker-side shim source, evaluated as CommonJS via `new Worker(source, { eval: true })`.
// The source below runs inside the worker thread, so it must not reference any
// host-side binding. Keep it self-contained and free of template literals —
// the outer template literal would interpolate `${...}` at host load time.
//
// workerData: { program: string, mode: 'check' | 'run', cwd?: string, execTimeoutMs: number }
export const WORKER_SHIM_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const { execFile } = require('node:child_process')

const EXEC_MAX_OUTPUT_BYTES = 256 * 1024
const TRUNCATED_OUTPUT_MARKER = '…[truncated]'

function truncateOutput(text) {
  return text.length > EXEC_MAX_OUTPUT_BYTES
    ? text.slice(0, EXEC_MAX_OUTPUT_BYTES) + TRUNCATED_OUTPUT_MARKER
    : text
}

function truncateOutputAtCap(text) {
  return text.length >= EXEC_MAX_OUTPUT_BYTES
    ? text.slice(0, EXEC_MAX_OUTPUT_BYTES) + TRUNCATED_OUTPUT_MARKER
    : text
}

function exec(request) {
  const argv = request && request.argv
  const cwd = request && request.cwd
  if (!Array.isArray(argv) || argv.length === 0 || argv.some(arg => typeof arg !== 'string')) {
    return Promise.reject(new Error('tools.exec requires argv to be a non-empty array of strings.'))
  }
  return new Promise((resolve, reject) => {
    execFile(argv[0], argv.slice(1), {
      cwd: cwd === undefined ? workerData.cwd : cwd,
      encoding: 'utf8',
      maxBuffer: EXEC_MAX_OUTPUT_BYTES,
      timeout: workerData.execTimeoutMs,
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          reject(new Error('Command timed out after ' + workerData.execTimeoutMs + ' ms and was killed.'))
          return
        }
        if (typeof error.code === 'number') {
          resolve({ exitCode: error.code, stdout: truncateOutput(stdout), stderr: truncateOutput(stderr) })
          return
        }
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          // execFile capped stdio at maxBuffer and terminated the child; surface the capped output.
          resolve({ exitCode: 1, stdout: truncateOutputAtCap(stdout), stderr: truncateOutputAtCap(stderr) })
          return
        }
        reject(new Error('Command could not be executed: ' + error.message))
        return
      }
      resolve({ exitCode: 0, stdout: truncateOutput(stdout), stderr: truncateOutput(stderr) })
    })
  })
}

async function main() {
  const tools = { exec }
  const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(workerData.program, 'utf8').toString('base64')
  const mod = await import(moduleUrl)
  if (typeof mod.default !== 'function') {
    throw new Error('Program must export a default async function')
  }
  if (workerData.mode === 'check') {
    parentPort.postMessage({ ok: true })
    return
  }
  const result = await mod.default({ tools })
  parentPort.postMessage({ ok: true, result })
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  parentPort.postMessage({ ok: false, error: message })
})
`
