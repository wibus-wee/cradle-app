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
    const hostOptions = resolveOpencodeRuntimeHostOptions({ binaryPath: '/opt/opencode-native', directory: '/workspace/alpha' })
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
  })

  it('fails before spawn when no configured, managed, or PATH runtime exists', () => {
    expect(() => resolveOpencodeBinaryPath({ PATH: '' })).toThrow(expect.objectContaining({
      code: 'opencode_runtime_not_installed',
    }))
    expect(resolveOpencodeRuntimeHostOptions({ binaryPath: 'opencode-test' })).toEqual({
      binaryPath: 'opencode-test',
      managed: false,
      cwd: process.cwd(),
      accessMode: 'full-access',
    })
  })

  it('suppresses auto-update only for managed hosts', () => {
    expect(createOpencodeServerProcessOptions({ binaryPath: '/managed/opencode', managed: true, cwd: '/workspace', port: 45123 }).env)
      .toMatchObject({ OPENCODE_DISABLE_AUTOUPDATE: '1' })
    expect(createOpencodeServerProcessOptions({ binaryPath: '/external/opencode', managed: false, cwd: '/workspace', port: 45123 }))
      .not
.toHaveProperty('env')
  })

  it('injects OPENCODE_PERMISSION only for approval-required hosts', () => {
    const approvalRequired = createOpencodeServerProcessOptions({
      binaryPath: '/managed/opencode',
      managed: true,
      cwd: '/workspace',
      accessMode: 'approval-required',
      port: 45123,
    })
    expect(approvalRequired.env).toMatchObject({
      OPENCODE_PERMISSION: JSON.stringify({ '*': 'ask' }),
    })

    const fullAccess = createOpencodeServerProcessOptions({
      binaryPath: '/managed/opencode',
      managed: true,
      cwd: '/workspace',
      accessMode: 'full-access',
      port: 45123,
    })
    expect(fullAccess.env).not.toHaveProperty('OPENCODE_PERMISSION')
  })
})

describe('opencodeRuntimePool', () => {
  it('pools by binary path, cwd, and access mode, ref-counts leases, and closes after the idle TTL', async () => {
    vi.useFakeTimers()
    const hosts: OpencodeManagedHost[] = []
    const startHost = vi.fn(async (input) => {
      const host = createManagedHost(`${input.binaryPath}:${input.cwd}:${input.accessMode}:${hosts.length}`, input.accessMode)
      hosts.push(host)
      return host
    })
    const pool = new OpencodeRuntimePool({ idleTtlMs: 50, startHost })

    const first = await pool.acquire({ binaryPath: 'opencode-a', directory: '/workspace/a' })
    const second = await pool.acquire({ binaryPath: 'opencode-a', directory: '/workspace/a' })
    const otherCwd = await pool.acquire({ binaryPath: 'opencode-a', directory: '/workspace/b' })
    const otherBinary = await pool.acquire({ binaryPath: 'opencode-b', directory: '/workspace/a' })
    const approvalRequired = await pool.acquire({ binaryPath: 'opencode-a', directory: '/workspace/a', accessMode: 'approval-required' })

    expect(startHost).toHaveBeenCalledTimes(4)
    expect(first.resource).toBe(second.resource)
    expect(first.resource).not.toBe(approvalRequired.resource)
    expect(hosts[3]?.accessMode).toBe('approval-required')
    const resources = pool.getResources()
    expect(resources).toHaveLength(4)
    expect(resources.map(resource => resource.url)).toEqual(expect.arrayContaining([
      'http://opencode-a:/workspace/a:full-access:0',
      'http://opencode-a:/workspace/b:full-access:1',
      'http://opencode-b:/workspace/a:full-access:2',
      'http://opencode-a:/workspace/a:approval-required:3',
    ]))
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
    approvalRequired.release()
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

    const first = await pool.acquire({ binaryPath: 'opencode-a', directory: '/workspace/a' })
    first.release()
    await vi.advanceTimersByTimeAsync(25)
    const reacquired = await pool.acquire({ binaryPath: 'opencode-a', directory: '/workspace/a' })
    await vi.advanceTimersByTimeAsync(100)
    expect(hosts[0]?.close).not.toHaveBeenCalled()

    exitCallbacks[0]?.(1, null)
    const restarted = await pool.acquire({ binaryPath: 'opencode-a', directory: '/workspace/a' })
    expect(startHost).toHaveBeenCalledTimes(2)
    expect(restarted.resource).not.toBe(reacquired.resource)

    reacquired.release()
    restarted.release()
    await pool.shutdown()
  })

  it('refuses active and pending removals, then disposes an idle path', async () => {
    let finishStartup: ((host: OpencodeManagedHost) => void) | null = null
    const pendingHost = new Promise<OpencodeManagedHost>((resolve) => { finishStartup = resolve })
    const pendingPool = new OpencodeRuntimePool({ startHost: vi.fn(async () => await pendingHost) })
    const pendingLease = pendingPool.acquire({ binaryPath: '/managed/pending', directory: '/workspace' })
    await expect(pendingPool.preparePathForRemoval('/managed/pending')).resolves.toBe(false)
    finishStartup!(createManagedHost('pending'))
    const resolvedPendingLease = await pendingLease
    resolvedPendingLease.release()
    await pendingPool.shutdown()

    const host = createManagedHost('managed')
    const pool = new OpencodeRuntimePool({
      idleTtlMs: 60_000,
      startHost: vi.fn(async () => host),
    })
    const lease = await pool.acquire({ binaryPath: '/managed/opencode', directory: '/workspace' })
    await expect(pool.preparePathForRemoval('/managed/opencode')).resolves.toBe(false)
    lease.release()
    await expect(pool.preparePathForRemoval('/managed/opencode')).resolves.toBe(true)
    expect(host.close).toHaveBeenCalledOnce()
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

function createManagedHost(id: string, accessMode: 'approval-required' | 'full-access' = 'full-access'): OpencodeManagedHost {
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
    accessMode,
    startedAt: Date.now(),
    close,
  }
}
