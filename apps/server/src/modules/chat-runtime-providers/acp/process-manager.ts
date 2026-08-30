import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'

import type { AcpDevtoolEvent } from '@cradle/ipc'

import type { ManagedChildProcess } from '../../../infra/managed-process'
import { spawnManagedProcess } from '../../../infra/managed-process'
import type { AcpLaunchDistributionType } from '../../acp/launch-config'
import { resolveBinaryCommand } from '../../acp/launch-config'

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

export interface AcpProcessSpawnOptions {
  agentId: string
  cmd: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  distributionType: AcpLaunchDistributionType
  installPath?: string | null
}

export interface AcpProcessHost {
  spawn: (options: AcpProcessSpawnOptions) => ProcessEntry
  stop: (agentId: string) => Promise<void>
  getMetrics: () => ProcessMetrics[]
  getDiagnostics?: (agentId: string) => string[]
}

const STDERR_MAX = 200
const RE_CARRIAGE_RETURN = /\r/g

interface LineCollector {
  consume: (text: string) => void
  flush: () => void
}

export class AcpProcessManager implements AcpProcessHost {
  private readonly processes = new Map<string, ProcessEntry>()
  private readonly lastDiagnostics = new Map<string, string[]>()
  private disposed = false

  constructor() {
    process.once('exit', () => {
      this.disposeAll()
    })
  }

  spawn(opts: AcpProcessSpawnOptions): ProcessEntry {
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
    publishAcpDevtoolEvent({
      agentId: opts.agentId,
      pid: proc.targetPid ?? proc.pid ?? null,
      kind: 'spawn',
      stream: 'lifecycle',
      text: 'ACP agent process started',
      command,
      args: finalArgs,
      cwd,
      exitCode: null,
      signal: null,
    })

    const stderrBuf: string[] = []
    const stderrCollector = createLineCollector((line) => {
      pushStderr(stderrBuf, line)
      this.lastDiagnostics.set(opts.agentId, [...stderrBuf])
    })

    proc.stderr?.setEncoding('utf-8')
    proc.stderr?.on('data', (chunk: string) => {
      stderrCollector.consume(chunk)
      publishAcpDevtoolEvent({
        agentId: opts.agentId,
        pid: proc.targetPid ?? proc.pid ?? null,
        kind: 'output',
        stream: 'stderr',
        text: chunk,
        command: null,
        args: null,
        cwd: null,
        exitCode: null,
        signal: null,
      })
    })
    proc.stdout?.on('data', (chunk: Buffer | string) => {
      publishAcpDevtoolEvent({
        agentId: opts.agentId,
        pid: proc.targetPid ?? proc.pid ?? null,
        kind: 'output',
        stream: 'stdout',
        text: chunk.toString(),
        command: null,
        args: null,
        cwd: null,
        exitCode: null,
        signal: null,
      })
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
    proc.on('exit', (exitCode, signal) => {
      stderrCollector.flush()
      this.processes.delete(opts.agentId)
      publishAcpDevtoolEvent({
        agentId: opts.agentId,
        pid: proc.targetPid ?? proc.pid ?? null,
        kind: 'exit',
        stream: 'lifecycle',
        text: 'ACP agent process exited',
        command: null,
        args: null,
        cwd: null,
        exitCode,
        signal,
      })
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

  getDiagnostics(agentId: string): string[] {
    return [...(this.processes.get(agentId)?.stderrBuf ?? this.lastDiagnostics.get(agentId) ?? [])]
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

function publishAcpDevtoolEvent(event: Omit<AcpDevtoolEvent, 'id' | 'timestamp'>): void {
  process.send?.({
    type: 'cradle-acp-devtool-event',
    event: { id: randomUUID(), timestamp: Date.now(), ...event },
  })
}

function resolveLaunchCommand(opts: {
  cmd: string
  args: string[]
  distributionType: AcpLaunchDistributionType
  installPath?: string | null
}): { command: string, finalArgs: string[] } {
  switch (opts.distributionType) {
    case 'command':
      return {
        command: opts.cmd,
        finalArgs: opts.args,
      }
    case 'binary':
      if (!opts.installPath) {
        throw new Error('installPath is required for binary ACP agents')
      }
      return {
        command: resolveBinaryCommand(opts.installPath, opts.cmd),
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
