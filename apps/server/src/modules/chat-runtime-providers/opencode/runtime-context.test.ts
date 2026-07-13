import { EventEmitter } from 'node:events'

import type { OpencodeClient } from '@opencode-ai/sdk'
import type { OpencodeClient as OpencodeV2Client } from '@opencode-ai/sdk/v2'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ManagedChildProcess } from '../../../infra/managed-process'
import type { OpencodeManagedHost } from './runtime-context'
import {
  createOpencodeServerProcessOptions,
  OpencodeRuntimePool,
  resolveOpencodeBinaryPath,
  resolveOpencodeRuntimeHostOptions,
  stopOpencodeServer,
} from './runtime-context'

afterEach(async () => {
  vi.useRealTimers()
  vi.clearAllMocks()
  await stopOpencodeServer()
})

describe('openCode runtime host options', () => {
  it('uses the configured binary and workspace cwd without injecting isolated OpenCode config', () => {
    const previousBinaryPath = process.env.CRADLE_OPENCODE_PATH
    process.env.CRADLE_OPENCODE_PATH = ' /opt/opencode-native '

    try {
      const hostOptions = resolveOpencodeRuntimeHostOptions({ directory: '/workspace/alpha' })
      const launchOptions = createOpencodeServerProcessOptions({
        ...hostOptions,
        port: 45123,
      })

      expect(launchOptions).toEqual(expect.objectContaining({
        command: '/opt/opencode-native',
        cwd: '/workspace/alpha',
      }))
      expect(launchOptions).not.toHaveProperty('env')
      expect(launchOptions).not.toHaveProperty('OPENCODE_CONFIG_CONTENT')
      expect(launchOptions).not.toHaveProperty('OPENCODE_CONFIG_DIR')
      expect(launchOptions).not.toHaveProperty('OPENCODE_DB')
      expect(launchOptions).not.toHaveProperty('OPENCODE_DISABLE_PROJECT_CONFIG')
    }
    finally {
      if (previousBinaryPath === undefined) {
        delete process.env.CRADLE_OPENCODE_PATH
      }
      else {
        process.env.CRADLE_OPENCODE_PATH = previousBinaryPath
      }
    }
  })

  it('falls back to the native binary and server cwd', () => {
    expect(resolveOpencodeBinaryPath({})).toBe('opencode')
    expect(resolveOpencodeRuntimeHostOptions()).toEqual({
      binaryPath: resolveOpencodeBinaryPath(),
      cwd: process.cwd(),
    })
  })
})

describe('opencodeRuntimePool', () => {
  it('pools by binary path and cwd, ref-counts leases, and closes after the idle TTL', async () => {
    vi.useFakeTimers()
    const hosts: OpencodeManagedHost[] = []
    const startHost = vi.fn(async (input) => {
      const host = createManagedHost(`${input.binaryPath}:${input.cwd}:${hosts.length}`)
      hosts.push(host)
      return host
    })
    const pool = new OpencodeRuntimePool({ idleTtlMs: 50, startHost })

    const first = await pool.acquire({ binaryPath: 'opencode-a', directory: '/workspace/a' })
    const second = await pool.acquire({ binaryPath: 'opencode-a', directory: '/workspace/a' })
    const otherCwd = await pool.acquire({ binaryPath: 'opencode-a', directory: '/workspace/b' })
    const otherBinary = await pool.acquire({ binaryPath: 'opencode-b', directory: '/workspace/a' })

    expect(startHost).toHaveBeenCalledTimes(3)
    expect(first.resource).toBe(second.resource)
    first.release()
    await vi.advanceTimersByTimeAsync(100)
    expect(hosts[0]?.close).not.toHaveBeenCalled()

    second.release()
    await vi.advanceTimersByTimeAsync(49)
    expect(hosts[0]?.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(hosts[0]?.close).toHaveBeenCalledOnce()

    otherCwd.release()
    otherBinary.release()
    await pool.shutdown()
  })

  it('cancels an idle close on reacquire and removes a host when its child exits', async () => {
    vi.useFakeTimers()
    const exitCallbacks: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
    const hosts: OpencodeManagedHost[] = []
    const startHost = vi.fn(async (input) => {
      exitCallbacks.push(input.onExit)
      const host = createManagedHost(`host-${hosts.length}`)
      hosts.push(host)
      return host
    })
    const pool = new OpencodeRuntimePool({ idleTtlMs: 50, startHost })

    const first = await pool.acquire({ directory: '/workspace/a' })
    first.release()
    await vi.advanceTimersByTimeAsync(25)
    const reacquired = await pool.acquire({ directory: '/workspace/a' })
    await vi.advanceTimersByTimeAsync(100)
    expect(hosts[0]?.close).not.toHaveBeenCalled()

    exitCallbacks[0]?.(1, null)
    const restarted = await pool.acquire({ directory: '/workspace/a' })
    expect(startHost).toHaveBeenCalledTimes(2)
    expect(restarted.resource).not.toBe(reacquired.resource)

    reacquired.release()
    restarted.release()
    await pool.shutdown()
  })
})

function createManagedProcess(): ManagedChildProcess {
  const proc = Object.assign(new EventEmitter(), {
    stdout: null,
    stderr: null,
    targetPid: 1234,
    pid: 1234,
    exitCode: null,
    signalCode: null,
    stop: vi.fn(async () => undefined),
  })
  return proc as unknown as ManagedChildProcess
}

function createManagedHost(id: string): OpencodeManagedHost {
  const close = vi.fn(async () => undefined)
  return {
    resource: {
      client: {} as OpencodeClient,
      v2Client: {} as OpencodeV2Client,
      server: { url: `http://${id}`, close },
    },
    process: createManagedProcess(),
    url: `http://${id}`,
    binaryPath: 'opencode',
    cwd: '/workspace',
    startedAt: Date.now(),
    close,
  }
}
