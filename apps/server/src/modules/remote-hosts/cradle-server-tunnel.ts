import net from 'node:net'

import { AppError } from '../../errors/app-error'
import type { ManagedChildProcess } from '../../infra/managed-process'
import { spawnManagedProcess } from '../../infra/managed-process'
import type { RemoteHostSshProfile, SshProfileLaunchConfig } from './service'

export interface RemoteCradleServerTunnelOptions {
  hostId: string
  sshTarget: string
  sshArgs?: string[]
  sshExecutable?: string
  remoteHost: string
  remotePort: number
  readyTimeoutMs?: number
}

export interface RemoteCradleServerTunnelHandle {
  readonly hostId: string
  readonly localPort: number
  readonly localBaseUrl: string
  readonly pid: number | null
  readonly stderr: string
  onExit: (listener: (exit: { code: number | null, signal: NodeJS.Signals | null }) => void) => void
  close: () => Promise<void>
}

export async function allocateLocalPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to allocate a local TCP port.'))
          return
        }
        resolve(address.port)
      })
    })
  })
}

export async function startRemoteCradleServerTunnel(
  options: RemoteCradleServerTunnelOptions,
): Promise<RemoteCradleServerTunnelHandle> {
  const localPort = await allocateLocalPort()
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ExitOnForwardFailure=yes',
    ...(options.sshArgs ?? []),
    '-N',
    '-L',
    `127.0.0.1:${localPort}:${options.remoteHost}:${options.remotePort}`,
    options.sshTarget,
  ]
  const child = spawnManagedProcess({
    kind: 'spawn',
    command: options.sshExecutable ?? 'ssh',
    args,
    stdin: 'ignore',
    shutdownGraceMs: 2_000,
  })
  const handle = new NodeRemoteCradleServerTunnelHandle(options.hostId, localPort, child)
  await handle.waitUntilReady(options.readyTimeoutMs ?? 10_000)
  return handle
}

export function buildRemoteCradleSshLaunchConfig(profile: RemoteHostSshProfile): SshProfileLaunchConfig {
  const sshArgs: string[] = []
  if (profile.port !== null) {
    sshArgs.push('-p', String(profile.port))
  }
  if (profile.auth === 'identityFile' && profile.identityFilePath) {
    sshArgs.push('-i', profile.identityFilePath)
  }
  return {
    sshTarget: profile.user ? `${profile.user}@${profile.hostName}` : profile.hostName,
    sshArgs,
  }
}

class NodeRemoteCradleServerTunnelHandle implements RemoteCradleServerTunnelHandle {
  private stderrBuffer = ''
  private exited = false
  private readonly exitListeners = new Set<(exit: { code: number | null, signal: NodeJS.Signals | null }) => void>()
  private readonly spawnPromise: Promise<void>

  constructor(
    readonly hostId: string,
    readonly localPort: number,
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
        const exit = { code, signal }
        for (const listener of this.exitListeners) {
          listener(exit)
        }
        if (code !== null && code !== 0) {
          reject(new Error(`ssh tunnel exited before startup with code ${code}: ${this.stderr}`))
        }
      })
    })
  }

  get localBaseUrl(): string {
    return `http://127.0.0.1:${this.localPort}`
  }

  get pid(): number | null {
    return this.child.targetPid ?? this.child.pid ?? null
  }

  get stderr(): string {
    return this.stderrBuffer.trim()
  }

  onExit(listener: (exit: { code: number | null, signal: NodeJS.Signals | null }) => void): void {
    this.exitListeners.add(listener)
  }

  async waitUntilReady(timeoutMs: number): Promise<void> {
    await this.spawnPromise
    const deadline = Date.now() + timeoutMs
    while (Date.now() <= deadline) {
      if (this.exited) {
        throw new Error(`ssh tunnel exited before local port ${this.localPort} accepted connections${this.stderr ? `: ${this.stderr}` : ''}`)
      }
      if (await canConnectToLocalPort(this.localPort)) {
        return
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new AppError({
      code: 'remote_cradle_server_tunnel_timeout',
      status: 503,
      message: `SSH tunnel did not open local port ${this.localPort} within timeout.`,
      details: this.stderr ? { stderr: this.stderr } : undefined,
    })
  }

  async close(): Promise<void> {
    if (this.exited) {
      return
    }
    await this.child.stop('SIGTERM')
  }
}

async function canConnectToLocalPort(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
    socket.setTimeout(250, () => {
      socket.destroy()
      resolve(false)
    })
  })
}
