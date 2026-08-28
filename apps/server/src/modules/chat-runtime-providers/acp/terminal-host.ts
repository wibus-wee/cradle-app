import { randomUUID } from 'node:crypto'

import type {
  CreateTerminalRequest,
  TerminalExitStatus,
  TerminalOutputResponse,
  WaitForTerminalExitResponse,
} from '@agentclientprotocol/sdk'

import { spawnManagedProcess } from '../../../infra/managed-process'
import type { RuntimeBackgroundTerminal } from '../../chat-runtime/runtime-provider-types'

interface TerminalEntry {
  terminalId: string
  sessionId: string
  command: string
  cwd: string
  outputByteLimit: number
  output: string
  truncated: boolean
  exitStatus: TerminalExitStatus | null
  proc: ReturnType<typeof spawnManagedProcess>
  exited: Promise<WaitForTerminalExitResponse>
}

const DEFAULT_OUTPUT_BYTE_LIMIT = 1024 * 1024

export class AcpTerminalHost {
  private readonly entries = new Map<string, TerminalEntry>()

  create(request: CreateTerminalRequest): { terminalId: string } {
    const terminalId = randomUUID()
    const cwd = request.cwd ?? process.cwd()
    const proc = spawnManagedProcess({
      kind: 'spawn',
      command: request.command,
      args: request.args ?? [],
      cwd,
      env: {
        ...process.env as Record<string, string>,
        ...Object.fromEntries((request.env ?? []).map(item => [item.name, item.value])),
      },
      stdin: 'ignore',
      shutdownGraceMs: 3_000,
    })
    let resolveExited!: (status: WaitForTerminalExitResponse) => void
    const exited = new Promise<WaitForTerminalExitResponse>((resolve) => {
      resolveExited = resolve
    })
    const entry: TerminalEntry = {
      terminalId,
      sessionId: request.sessionId,
      command: [request.command, ...(request.args ?? [])].join(' '),
      cwd,
      outputByteLimit: request.outputByteLimit ?? DEFAULT_OUTPUT_BYTE_LIMIT,
      output: '',
      truncated: false,
      exitStatus: null,
      proc,
      exited,
    }
    const append = (chunk: Buffer | string) => {
      entry.output += chunk.toString()
      const trimmed = trimUtf8Start(entry.output, entry.outputByteLimit)
      entry.output = trimmed.output
      entry.truncated ||= trimmed.truncated
    }
    proc.stdout?.on('data', append)
    proc.stderr?.on('data', append)
    proc.once('exit', (exitCode, signal) => {
      entry.exitStatus = { exitCode, signal }
      resolveExited(entry.exitStatus)
    })
    this.entries.set(terminalId, entry)
    return { terminalId }
  }

  output(sessionId: string, terminalId: string): TerminalOutputResponse {
    const entry = this.requireEntry(sessionId, terminalId)
    return { output: entry.output, truncated: entry.truncated, exitStatus: entry.exitStatus }
  }

  async wait(sessionId: string, terminalId: string): Promise<WaitForTerminalExitResponse> {
    return await this.requireEntry(sessionId, terminalId).exited
  }

  async kill(sessionId: string, terminalId: string): Promise<void> {
    const entry = this.requireEntry(sessionId, terminalId)
    if (entry.proc.exitCode === null) { await entry.proc.stop('SIGTERM') }
  }

  async release(sessionId: string, terminalId: string): Promise<void> {
    await this.kill(sessionId, terminalId)
    this.entries.delete(terminalId)
  }

  list(sessionId: string): RuntimeBackgroundTerminal[] {
    return [...this.entries.values()]
      .filter(entry => entry.sessionId === sessionId && entry.exitStatus === null)
      .map(entry => ({
        itemId: entry.terminalId,
        processId: entry.terminalId,
        command: entry.command,
        cwd: entry.cwd,
        osPid: entry.proc.targetPid ?? entry.proc.pid ?? null,
        cpuPercent: null,
        rssKb: null,
      }))
  }

  private requireEntry(sessionId: string, terminalId: string): TerminalEntry {
    const entry = this.entries.get(terminalId)
    if (!entry || entry.sessionId !== sessionId) { throw new Error(`ACP terminal not found: ${terminalId}`) }
    return entry
  }
}

function trimUtf8Start(output: string, byteLimit: number): { output: string, truncated: boolean } {
  const bytes = Buffer.from(output)
  if (bytes.byteLength <= byteLimit) { return { output, truncated: false } }
  let start = bytes.byteLength - byteLimit
  while (start < bytes.byteLength && (bytes[start]! & 0b1100_0000) === 0b1000_0000) { start += 1 }
  return { output: bytes.subarray(start).toString('utf8'), truncated: true }
}
