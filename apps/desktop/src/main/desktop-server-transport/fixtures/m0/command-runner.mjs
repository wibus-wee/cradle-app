import { spawn } from 'node:child_process'

const DEFAULT_TERMINATION_GRACE_MS = 5_000
const DEFAULT_FORCE_SETTLE_MS = 1_000

function signalProcessTree(child, processGroupId, signal) {
  if (!processGroupId) { return }
  if (process.platform === 'win32') {
    const args = ['/pid', String(processGroupId), '/t']
    if (signal === 'SIGKILL') { args.push('/f') }
    try {
      const killer = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => undefined)
      killer.unref()
    }
    catch {
      child.kill(signal)
    }
    return
  }
  try {
    process.kill(-processGroupId, signal)
  }
  catch {
    if (child.exitCode === null && child.signalCode === null) { child.kill(signal) }
  }
}

export async function runCommand(command, args, options = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout = []
    const stderr = []
    const timeoutMs = options.timeoutMs ?? 120_000
    const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS
    const forceSettleMs = options.forceSettleMs ?? DEFAULT_FORCE_SETTLE_MS
    const processGroupId = child.pid
    let timedOut = false
    let settled = false
    let childOutcome
    let timeoutTimer
    let terminationTimer
    let forceSettleTimer

    const output = () => ({
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    })
    const clearTimers = () => {
      clearTimeout(timeoutTimer)
      clearTimeout(terminationTimer)
      clearTimeout(forceSettleTimer)
    }
    const settle = (outcome) => {
      if (settled) { return }
      settled = true
      clearTimers()
      resolvePromise({ ...outcome, timedOut, ...output() })
    }
    const forceCleanup = () => {
      child.stdout.destroy()
      child.stderr.destroy()
      child.unref()
    }

    child.stdout.on('data', (chunk) => {
      stdout.push(chunk)
      if (options.forwardOutput !== false) { process.stdout.write(chunk) }
    })
    child.stderr.on('data', (chunk) => {
      stderr.push(chunk)
      if (options.forwardOutput !== false) { process.stderr.write(chunk) }
    })
    child.once('error', (error) => {
      if (settled) { return }
      settled = true
      clearTimers()
      signalProcessTree(child, processGroupId, 'SIGKILL')
      forceCleanup()
      rejectPromise(error)
    })
    child.once('exit', (code, signal) => {
      childOutcome = { code, signal }
      if (!timedOut) { settle(childOutcome) }
    })

    timeoutTimer = setTimeout(() => {
      timedOut = true
      signalProcessTree(child, processGroupId, 'SIGTERM')
      terminationTimer = setTimeout(() => {
        signalProcessTree(child, processGroupId, 'SIGKILL')
        forceSettleTimer = setTimeout(() => {
          forceCleanup()
          settle(childOutcome ?? {
            code: child.exitCode,
            signal: child.signalCode ?? 'SIGKILL',
          })
        }, forceSettleMs)
      }, terminationGraceMs)
    }, timeoutMs)
  })
}
