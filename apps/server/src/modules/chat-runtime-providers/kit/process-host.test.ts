import { afterEach, describe, expect, it, vi } from 'vitest'

import { providerRuntimeHostManager } from '../../provider-runtime/host-manager'
import {
  acquireProviderProcessHostResource,
  createDetachedProcessHostLease,
  invalidateProviderProcessHostResource,
  listProviderProcessHosts,
  registerProcessHostLeaseCleanup,
} from './process-host'

describe('process host kit', () => {
  afterEach(() => {
    providerRuntimeHostManager.clear()
  })

  it('acquires and lists host-managed provider resources', async () => {
    const disposeResource = vi.fn()
    const lease = await acquireProviderProcessHostResource({
      runtimeKind: 'test-runtime',
      providerTargetId: 'target-1',
      scopeId: 'scope-1',
      resourceFingerprint: 'fingerprint-1',
      createResource: () => ({ pid: 1234 }),
      disposeResource,
    })

    expect(lease.resource).toEqual({ pid: 1234 })
    expect(listProviderProcessHosts()).toEqual([
      expect.objectContaining({
        hostId: 'test-runtime:target-1:scope-1',
        runtimeKind: 'test-runtime',
        providerTargetId: 'target-1',
        scopeId: 'scope-1',
        refCount: 1,
        hasResource: true,
      }),
    ])

    invalidateProviderProcessHostResource(lease.hostId)
    expect(disposeResource).toHaveBeenCalledWith({ pid: 1234 })
    lease.release()
  })

  it('creates detached leases for provider-owned singleton processes', () => {
    const resource = { url: 'http://127.0.0.1:1234' }
    const lease = createDetachedProcessHostLease(resource)

    expect(lease.resource).toBe(resource)
    expect(() => lease.refresh()).not.toThrow()
    expect(() => lease.release()).not.toThrow()
  })

  it('runs release cleanup exactly once before releasing the host lease', () => {
    const cleanup = vi.fn()
    const release = vi.fn()
    const lease = {
      release,
    }

    registerProcessHostLeaseCleanup(lease, cleanup)
    lease.release()
    lease.release()

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
    expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(release.mock.invocationCallOrder[0]!)
  })
})
