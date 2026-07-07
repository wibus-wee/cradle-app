import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface BaseManagedProcessOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  shutdownGraceMs?: number
}

export interface ManagedSpawnOptions extends BaseManagedProcessOptions {
  kind: 'spawn'
  command: string
  args?: string[]
  stdin?: 'ignore' | 'pipe'
}

export interface ManagedForkOptions extends BaseManagedProcessOptions {
  kind: 'fork'
  modulePath: string
  args?: string[]
  execPath?: string
  execArgv?: string[]
}

export type ManagedProcessOptions = ManagedSpawnOptions | ManagedForkOptions

export interface ManagedChildProcess extends ChildProcess {
  readonly targetPid: number | null
  stop: (signal?: NodeJS.Signals) => Promise<void>
}

const localModuleDir = dirname(fileURLToPath(import.meta.url))

function resolveRunnerPath(): string {
  const candidates = localModuleDir.endsWith('/src/infra') || localModuleDir.endsWith('\\src\\infra')
    ? [resolve(localModuleDir, 'managed-process-runner.ts')]
    : [
        resolve(localModuleDir, 'managed-process-runner.js'),
        resolve(dirname(localModuleDir), 'managed-process-runner.js'),
      ]
  const runnerPath = candidates.find(candidate => existsSync(candidate))
  if (runnerPath) {
    return runnerPath
  }
  return candidates[0]!
}

export function spawnManagedProcess(options: ManagedProcessOptions): ManagedChildProcess {
  let targetPid: number | null = null
  const child = fork(resolveRunnerPath(), [JSON.stringify(normalizeOptions(options))], {
    execArgv: process.execArgv,
    stdio: [
      options.kind === 'spawn' && options.stdin === 'pipe' ? 'pipe' : 'ignore',
      'pipe',
      'pipe',
      'ipc',
    ],
  }) as ManagedChildProcess

  child.on('message', (message) => {
    if (
      typeof message === 'object'
      && message !== null
      && 'type' in message
      && message.type === 'started'
      && 'pid' in message
      && typeof message.pid === 'number'
    ) {
      targetPid = message.pid
    }
  })

  Object.defineProperty(child, 'targetPid', {
    get: () => targetPid,
  })
  child.stop = async (signal: NodeJS.Signals = 'SIGTERM') => {
    await stopManagedProcess(child, signal)
  }
  return child
}

function normalizeOptions(options: ManagedProcessOptions): ManagedProcessOptions {
  if (options.kind === 'spawn') {
    return {
      ...options,
      args: options.args ?? [],
      stdin: options.stdin ?? 'ignore',
    }
  }
  return {
    ...options,
    args: options.args ?? [],
  }
}

export async function stopManagedProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  await new Promise<void>((resolveStop) => {
    let resolved = false
    const finish = () => {
      if (resolved) {
        return
      }
      resolved = true
      child.off('exit', finish)
      child.off('error', finish)
      resolveStop()
    }
    child.once('exit', finish)
    child.once('error', finish)
    child.kill(signal)
  })
}
