import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AppError } from '../../errors/app-error'
import { MockSandboxRuntime, setSandboxRuntimeForTests } from './runtime'
import * as Sandbox from './service'
import {
  resetSandboxStoreForTests,
  useMemorySandboxStoreForTests,
} from './store'

describe('sandbox service', () => {
  let runtime: MockSandboxRuntime
  let mountRoot: string

  beforeEach(() => {
    useMemorySandboxStoreForTests()
    resetSandboxStoreForTests()
    runtime = new MockSandboxRuntime()
    setSandboxRuntimeForTests(runtime)
    process.env.CRADLE_SANDBOX_MIN_WARM = '0'
    process.env.CRADLE_SANDBOX_MAX_TOTAL = '4'
    process.env.CRADLE_SANDBOX_MAX_PER_WORK = '2'
    mountRoot = mkdtempSync(join(tmpdir(), 'cradle-sandbox-mount-'))
    writeFileSync(join(mountRoot, 'package.json'), '{"name":"demo"}\n')
  })

  afterEach(() => {
    setSandboxRuntimeForTests(null)
    resetSandboxStoreForTests()
    delete process.env.CRADLE_SANDBOX_MIN_WARM
    delete process.env.CRADLE_SANDBOX_MAX_TOTAL
    delete process.env.CRADLE_SANDBOX_MAX_PER_WORK
    rmSync(mountRoot, { recursive: true, force: true })
  })

  it('lists built-in profiles', () => {
    const profiles = Sandbox.listProfiles()
    expect(profiles.map(profile => profile.id).sort()).toEqual(['node22', 'python312'])
  })

  it('leases, execs, and releases a sandbox against the mock runtime', async () => {
    const lease = await Sandbox.leaseSandbox({
      profileId: 'node22',
      workspaceId: 'ws_1',
      workId: 'work_1',
      sessionId: 'session_1',
      purpose: 'unit',
      mountPath: mountRoot,
      mountWritable: false,
    })

    expect(lease.profileId).toBe('node22')
    expect(lease.releasedAt).toBeNull()
    expect(lease.mountsResolved.some(mount => (
      mount.hostPath === mountRoot
      && mount.containerPath === '/workspace'
      && mount.readOnly
    ))).toBe(true)
    expect(runtime.createCount).toBe(1)

    const exec = await Sandbox.execInLease({
      leaseId: lease.id,
      command: ['node', '-e', 'console.log(1)'],
    })
    expect(exec.exitCode).toBe(0)
    expect(exec.stdout).toContain('node')

    const released = await Sandbox.releaseLease(lease.id)
    expect(released.releasedAt).not.toBeNull()
    expect(Sandbox.listLeases({ workId: 'work_1' })).toHaveLength(0)
    expect(runtime.removeCount).toBeGreaterThanOrEqual(1)
  })

  it('rejects unknown profiles and capacity overflows', async () => {
    await expect(Sandbox.leaseSandbox({
      profileId: 'missing',
      workspaceId: 'ws_1',
      mountPath: mountRoot,
    })).rejects.toMatchObject({ code: 'sandbox_profile_not_found' } satisfies Partial<AppError>)

    process.env.CRADLE_SANDBOX_MAX_TOTAL = '1'
    await Sandbox.leaseSandbox({
      profileId: 'node22',
      workspaceId: 'ws_1',
      workId: 'work_a',
      mountPath: mountRoot,
    })
    await expect(Sandbox.leaseSandbox({
      profileId: 'node22',
      workspaceId: 'ws_1',
      workId: 'work_b',
      mountPath: mountRoot,
    })).rejects.toMatchObject({ code: 'sandbox_capacity_exceeded' })
  })

  it('enforces per-work lease caps', async () => {
    process.env.CRADLE_SANDBOX_MAX_PER_WORK = '1'
    await Sandbox.leaseSandbox({
      profileId: 'node22',
      workspaceId: 'ws_1',
      workId: 'work_1',
      mountPath: mountRoot,
    })
    await expect(Sandbox.leaseSandbox({
      profileId: 'python312',
      workspaceId: 'ws_1',
      workId: 'work_1',
      mountPath: mountRoot,
    })).rejects.toMatchObject({ code: 'sandbox_work_capacity_exceeded' })
  })

  it('refills warm pool and consumes a warm slot on lease', async () => {
    process.env.CRADLE_SANDBOX_MIN_WARM = '1'
    process.env.CRADLE_SANDBOX_MAX_TOTAL = '8'
    const warmed = await Sandbox.refillWarmPool()
    expect(warmed).toBeGreaterThanOrEqual(2)
    const before = await Sandbox.getPoolStatus()
    expect(before.totals.warm).toBeGreaterThanOrEqual(2)

    const createBefore = runtime.createCount
    await Sandbox.leaseSandbox({
      profileId: 'node22',
      workspaceId: 'ws_1',
      mountPath: mountRoot,
    })
    // warm destroy + leased create
    expect(runtime.createCount).toBeGreaterThan(createBefore)
    const after = await Sandbox.getPoolStatus()
    expect(after.totals.leased).toBe(1)
  })

  it('reconcile removes engine orphans and expired leases', async () => {
    const lease = await Sandbox.leaseSandbox({
      profileId: 'node22',
      workspaceId: 'ws_1',
      mountPath: mountRoot,
      ttlSec: 1,
    })
    // Force expiry
    const { updateSandboxStore } = await import('./store')
    updateSandboxStore((store) => {
      const row = store.leases.find(item => item.id === lease.id)
      if (row) {
        row.expiresAt = Math.floor(Date.now() / 1000) - 10
      }
    })

    // Inject an orphan labeled container
    const orphan = await runtime.create({
      name: 'orphan',
      image: 'node:22-bookworm-slim',
      workdir: '/workspace',
      env: {},
      mounts: [],
      networkMode: 'none',
      labels: { 'cradle.sandbox': '1' },
    })
    await runtime.start(orphan.id)

    const result = await Sandbox.reconcilePool()
    expect(result.expiredReleased).toBe(1)
    expect(result.orphansRemoved).toBe(1)
    expect(Sandbox.listLeases({ includeReleased: false })).toHaveLength(0)
  })

  it('fails closed when the engine is unavailable', async () => {
    runtime.setAvailable(false)
    await expect(Sandbox.leaseSandbox({
      profileId: 'node22',
      workspaceId: 'ws_1',
      mountPath: mountRoot,
    })).rejects.toMatchObject({ code: 'sandbox_engine_unavailable' })
  })
})
