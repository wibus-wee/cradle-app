import type { ChildProcess } from 'node:child_process'
import { fork, spawn } from 'node:child_process'

interface BaseTarget {
  cwd?: string
  env?: Record<string, string | undefined>
  shutdownGraceMs?: number
}

interface SpawnTarget extends BaseTarget {
  kind: 'spawn'
  command: string
  args: string[]
  stdin: 'ignore' | 'pipe'
}

interface ForkTarget extends BaseTarget {
  kind: 'fork'
  modulePath: string
  args: string[]
  execPath?: string
  execArgv?: string[]
}

type ManagedTarget = SpawnTarget | ForkTarget

const DEFAULT_SHUTDOWN_GRACE_MS = 3_000
const target = JSON.parse(process.argv[2] ?? '{}') as ManagedTarget

let child: ChildProcess | null = null
let stopping = false

function emitStatus(message: Record<string, unknown>): void {
  if (process.send) {
    process.send(message)
  }
}

function targetEnv(env: Record<string, string | undefined> | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...env,
  }
}

function startTarget(): ChildProcess {
  if (target.kind === 'fork') {
    return fork(target.modulePath, target.args, {
      cwd: target.cwd,
      env: targetEnv(target.env),
      execPath: target.execPath,
      execArgv: target.execArgv,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
  }
  return spawn(target.command, target.args, {
    cwd: target.cwd,
    env: targetEnv(target.env),
    detached: process.platform !== 'win32',
    stdio: [target.stdin, 'pipe', 'pipe'],
  })
}

function signalChild(signal: NodeJS.Signals): boolean {
  const pid = child?.pid
  if (!child || child.exitCode !== null || child.signalCode !== null || !pid) {
    return false
  }
  try {
    if (process.platform !== 'win32') {
      process.kill(-pid, signal)
    }
    else {
      child.kill(signal)
    }
    return true
  }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') {
      return false
    }
    throw error
  }
}

function stopTarget(reason: string, exitCode: number): void {
  if (stopping) {
    return
  }
  stopping = true
  emitStatus({ type: 'stopping', reason })
  if (!signalChild('SIGTERM')) {
    process.exit(exitCode)
  }
  const timer = setTimeout(() => {
    signalChild('SIGKILL')
    setTimeout(() => process.exit(exitCode), 250).unref()
  }, target.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS)
  timer.unref()
}

try {
  child = startTarget()
  emitStatus({ type: 'started', pid: child.pid ?? null })
  if (target.kind === 'spawn' && target.stdin === 'pipe' && child.stdin) {
    process.stdin.pipe(child.stdin)
  }
  child.stdout?.pipe(process.stdout)
  child.stderr?.pipe(process.stderr)
  child.once('error', (error) => {
    emitStatus({ type: 'error', message: error.message })
    process.exit(1)
  })
  child.once('exit', (code, signal) => {
    emitStatus({ type: 'exit', code, signal })
    process.exit(code ?? (signal ? 1 : 0))
  })
}
catch (error) {
  emitStatus({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  process.exit(1)
}

process.once('disconnect', () => stopTarget('owner-disconnect', 0))
process.once('SIGTERM', () => stopTarget('runner-sigterm', 0))
process.once('SIGINT', () => stopTarget('runner-sigint', 0))
