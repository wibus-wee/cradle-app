import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

import type { ManagedChildProcess } from '../../../infra/managed-process'
import { spawnManagedProcess } from '../../../infra/managed-process'

export interface ProcessMetrics {
  pid: number
  agentId: string
  startedAt: number
  uptimeMs: number
  stderrLines: string[]
}

export interface ProcessEntry {
  agentId: string
  proc: ManagedChildProcess
  startedAt: number
  stderrBuf: string[]
  stdinWeb: WritableStream<Uint8Array>
  stdoutWeb: ReadableStream<Uint8Array>
}

const STDERR_MAX = 200
const RE_CARRIAGE_RETURN = /\r/g

interface LineCollector {
  consume: (text: string) => void
  flush: () => void
}

export class AcpProcessManager {
  private readonly processes = new Map<string, ProcessEntry>()
  private disposed = false

  constructor() {
    process.once('exit', () => {
      this.disposeAll()
    })
  }

  spawn(opts: {
    agentId: string
    cmd: string
    args: string[]
    env: Record<string, string>
    cwd?: string
    distributionType: 'binary' | 'npx' | 'uvx'
    installPath?: string | null
  }): ProcessEntry {
    if (this.disposed) {
      throw new Error('AcpProcessManager has been disposed')
    }
    if (this.processes.has(opts.agentId)) {
      throw new Error(`Agent ${opts.agentId} is already running`)
    }

    const { command, finalArgs } = resolveLaunchCommand(opts)
    const cwd = opts.cwd ?? process.env.HOME ?? process.cwd()
    const proc = spawnManagedProcess({
      kind: 'spawn',
      command,
      args: finalArgs,
      stdin: 'pipe',
      env: {
        ...process.env as Record<string, string>,
        ...opts.env,
      },
      cwd,
      shutdownGraceMs: 5_000,
    })

    const stderrBuf: string[] = []
    const stderrCollector = createLineCollector((line) => {
      pushStderr(stderrBuf, line)
    })

    proc.stderr?.setEncoding('utf-8')
    proc.stderr?.on('data', (chunk: string) => {
      stderrCollector.consume(chunk)
    })
    proc.stderr?.on('end', () => {
      stderrCollector.flush()
    })
    proc.stderr?.on('close', () => {
      stderrCollector.flush()
    })

    const entry: ProcessEntry = {
      agentId: opts.agentId,
      proc,
      startedAt: Date.now(),
      stderrBuf,
      stdinWeb: Writable.toWeb(proc.stdin as Writable) as WritableStream<Uint8Array>,
      stdoutWeb: Readable.toWeb(proc.stdout as Readable) as ReadableStream<Uint8Array>,
    }

    this.processes.set(opts.agentId, entry)
    proc.on('exit', () => {
      stderrCollector.flush()
      this.processes.delete(opts.agentId)
    })

    return entry
  }

  async stop(agentId: string): Promise<void> {
    const entry = this.processes.get(agentId)
    if (!entry) {
      return
    }

    this.processes.delete(agentId)
    const { proc } = entry

    if (proc.exitCode !== null) {
      return
    }

    await proc.stop('SIGTERM')
  }

  isRunning(agentId: string): boolean {
    return this.processes.has(agentId)
  }

  get(agentId: string): ProcessEntry | undefined {
    return this.processes.get(agentId)
  }

  getMetrics(): ProcessMetrics[] {
    const now = Date.now()
    return Array.from(this.processes.values(), entry => ({
        pid: entry.proc.targetPid ?? entry.proc.pid ?? -1,
      agentId: entry.agentId,
      startedAt: entry.startedAt,
      uptimeMs: now - entry.startedAt,
      stderrLines: [...entry.stderrBuf],
    }))
  }

  disposeAll(): void {
    this.disposed = true
    for (const entry of this.processes.values()) {
      if (entry.proc.exitCode === null) {
        void entry.proc.stop('SIGTERM')
      }
    }
    this.processes.clear()
  }
}

function resolveLaunchCommand(opts: {
  cmd: string
  args: string[]
  distributionType: 'binary' | 'npx' | 'uvx'
  installPath?: string | null
}): { command: string, finalArgs: string[] } {
  switch (opts.distributionType) {
    case 'binary':
      if (!opts.installPath) {
        throw new Error('installPath is required for binary ACP agents')
      }
      return {
        command: join(opts.installPath, opts.cmd),
        finalArgs: opts.args,
      }
    case 'npx':
      return {
        command: 'npx',
        finalArgs: ['-y', opts.cmd, ...opts.args],
      }
    case 'uvx':
      return {
        command: 'uvx',
        finalArgs: [opts.cmd, ...opts.args],
      }
  }
}

function pushStderr(buf: string[], line: string): void {
  buf.push(line)
  if (buf.length > STDERR_MAX) {
    buf.shift()
  }
}

function createLineCollector(onLine: (line: string) => void): LineCollector {
  let carry = ''

  const pushLines = (input: string): void => {
    carry += input.replace(RE_CARRIAGE_RETURN, '')
    const lines = carry.split('\n')
    carry = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) {
        onLine(line)
      }
    }
  }

  return {
    consume: pushLines,
    flush: () => {
      if (carry.trim()) {
        onLine(carry)
      }
      carry = ''
    },
  }
}
