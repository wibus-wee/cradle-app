import { describe, expect, it } from 'vitest'

import { runCommand } from './command-runner.mjs'

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') { return false }
    throw error
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (!isProcessAlive(pid)) { return true }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return !isProcessAlive(pid)
}

describe('m0 command runner', () => {
  it('settles after escalating a timed-out process that ignores termination', async () => {
    const startedAt = performance.now()
    const outcome = await runCommand(process.execPath, [
      '-e',
      'process.on("SIGTERM", () => undefined); setInterval(() => undefined, 1_000)',
    ], {
      cwd: process.cwd(),
      timeoutMs: 500,
      terminationGraceMs: 100,
      forceSettleMs: 100,
      forwardOutput: false,
    })

    expect(outcome.timedOut).toBe(true)
    expect(performance.now() - startedAt).toBeLessThan(2_000)
    if (process.platform !== 'win32') { expect(outcome.signal).toBe('SIGKILL') }
  })

  it.skipIf(process.platform === 'win32')('retains process-group cleanup when the parent exits and its descendant ignores termination', async () => {
    let descendantPid
    try {
      const startedAt = performance.now()
      const outcome = await runCommand(process.execPath, [
        '-e',
        [
          'const { spawn } = require("node:child_process")',
          'const descendant = spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\", () => undefined); setInterval(() => undefined, 1_000)"], { stdio: "ignore" })',
          'process.stdout.write(String(descendant.pid))',
          'setInterval(() => undefined, 1_000)',
        ].join('; '),
      ], {
        cwd: process.cwd(),
        timeoutMs: 500,
        terminationGraceMs: 100,
        forceSettleMs: 100,
        forwardOutput: false,
      })
      descendantPid = Number.parseInt(outcome.stdout, 10)

      expect(outcome.timedOut).toBe(true)
      expect(outcome.signal).toBe('SIGTERM')
      expect(performance.now() - startedAt).toBeLessThan(2_000)
      expect(Number.isSafeInteger(descendantPid)).toBe(true)
      expect(await waitForProcessExit(descendantPid, 1_000)).toBe(true)
    }
    finally {
      if (descendantPid && isProcessAlive(descendantPid)) { process.kill(descendantPid, 'SIGKILL') }
    }
  })

  it('rejects a spawn error without waiting for the timeout', async () => {
    const startedAt = performance.now()
    await expect(runCommand('cradle-m0-command-that-does-not-exist', [], {
      cwd: process.cwd(),
      timeoutMs: 5_000,
      forwardOutput: false,
    })).rejects.toMatchObject({ code: 'ENOENT' })
    expect(performance.now() - startedAt).toBeLessThan(2_000)
  })
})
