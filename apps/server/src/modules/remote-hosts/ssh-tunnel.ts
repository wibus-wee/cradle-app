import { existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

import type { ManagedChildProcess } from '../../infra/managed-process'
import { spawnManagedProcess } from '../../infra/managed-process'

export interface SshTunnelOptions {
  hostId: string
  sshTarget: string
  localSocketPath: string
  remoteSocketPath: string
  sshExecutable?: string
  sshArgs?: string[]
  readyTimeoutMs?: number
}

export interface SshTunnelExit {
  code: number | null
  signal: NodeJS.Signals | null
}

export interface SshTunnelHandle {
  readonly hostId: string
  readonly localSocketPath: string
  readonly remoteSocketPath: string
  readonly sshTarget: string
  readonly pid: number | null
  readonly stderr: string
  onExit: (listener: (exit: SshTunnelExit) => void) => void
  close: () => Promise<void>
}

export async function startSshTunnel(options: SshTunnelOptions): Promise<SshTunnelHandle> {
  mkdirSync(dirname(options.localSocketPath), { recursive: true })
  removeStaleLocalSocket(options.localSocketPath)

  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'StreamLocalBindUnlink=yes',
    ...(options.sshArgs ?? []),
    '-N',
    '-L',
    `${options.localSocketPath}:${options.remoteSocketPath}`,
    options.sshTarget,
  ]
  const child = spawnManagedProcess({
    kind: 'spawn',
    command: options.sshExecutable ?? 'ssh',
    args,
    stdin: 'ignore',
    shutdownGraceMs: 2_000,
  })

  const handle = new NodeSshTunnelHandle(options, child)
  await handle.waitUntilReady()
  return handle
}

class NodeSshTunnelHandle implements SshTunnelHandle {
  private stderrBuffer = ''
  private exited = false
  private exit: SshTunnelExit | null = null
  private readonly exitListeners = new Set<(exit: SshTunnelExit) => void>()
  private readonly spawnPromise: Promise<void>

  constructor(
    private readonly options: SshTunnelOptions,
    private readonly child: ManagedChildProcess,
  ) {
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk.toString('utf8')}`.slice(-16_384)
    })
    this.spawnPromise = new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        this.exited = true
        this.exit = { code, signal }
        for (const listener of this.exitListeners) {
          listener(this.exit)
        }
        if (code !== null && code !== 0) {
          reject(new Error(`ssh tunnel exited before startup with code ${code}: ${this.stderr}`))
        }
      })
    })
  }

  get hostId(): string {
    return this.options.hostId
  }

  get localSocketPath(): string {
    return this.options.localSocketPath
  }

  get remoteSocketPath(): string {
    return this.options.remoteSocketPath
  }

  get sshTarget(): string {
    return this.options.sshTarget
  }

  get pid(): number | null {
    return this.child.targetPid ?? this.child.pid ?? null
  }

  get stderr(): string {
    return this.stderrBuffer.trim()
  }

  async waitUntilReady(): Promise<void> {
    await this.spawnPromise
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? 10_000)
    while (Date.now() <= deadline) {
      if (existsSync(this.options.localSocketPath) && lstatSync(this.options.localSocketPath).isSocket()) {
        return
      }
      if (this.exited) {
        throw new Error(this.formatExitBeforeReady())
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(
      `ssh tunnel did not create local socket ${this.options.localSocketPath} within timeout.${
       this.stderr ? ` ssh stderr: ${this.stderr}` : ''}`,
    )
  }

  onExit(listener: (exit: SshTunnelExit) => void): void {
    this.exitListeners.add(listener)
  }

  async close(): Promise<void> {
    if (this.exited) {
      return
    }
    await this.child.stop('SIGTERM')
  }

  private formatExitBeforeReady(): string {
    const code = this.exit?.code ?? null
    const signal = this.exit?.signal ?? null
    return `ssh tunnel exited before creating local socket ${this.options.localSocketPath}`
      + ` with code ${code ?? 'null'} signal ${signal ?? 'null'}${
       this.stderr ? `: ${this.stderr}` : ''}`
  }
}

function removeStaleLocalSocket(localSocketPath: string): void {
  if (!existsSync(localSocketPath)) {
    return
  }
  const stat = lstatSync(localSocketPath)
  if (!stat.isSocket()) {
    throw new Error(`Local tunnel path exists and is not a socket: ${localSocketPath}`)
  }
  rmSync(localSocketPath, { force: true })
}
