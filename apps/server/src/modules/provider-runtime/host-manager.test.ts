import { describe, expect, it, vi } from 'vitest'

import { ProviderRuntimeHostManager } from './host-manager'

describe('provider runtime host manager', () => {
  it('keeps an unpinned host warm until its idle timeout and reuses it for a follow-up lease', async () => {
    const manager = new ProviderRuntimeHostManager()
    const createResource = vi.fn(() => ({ pid: 1234 }))
    const disposeResource = vi.fn()
    const input = {
      runtimeKind: 'codex',
      providerTargetId: 'target-1',
      scopeId: 'chat-session:session-1',
      ttlMs: 30_000,
      retainOnRelease: true,
      createResource,
      disposeResource,
    }

    const firstLease = await manager.acquireResource(input)
    firstLease.release()

    expect(disposeResource).not.toHaveBeenCalled()
    expect(manager.listHosts()).toEqual([
      expect.objectContaining({
        hostId: 'codex:target-1:chat-session:session-1',
        refCount: 0,
        hasResource: true,
      }),
    ])

    const secondLease = await manager.acquireResource(input)
    expect(secondLease.resource).toBe(firstLease.resource)
    expect(createResource).toHaveBeenCalledOnce()
    secondLease.release()

    const expiresAt = manager.listHosts()[0]!.expiresAt
    manager.reapIdleHosts(expiresAt)

    expect(disposeResource).toHaveBeenCalledWith({ pid: 1234 })
    expect(manager.listHosts()).toEqual([])
  })

  it('disposes a zero-TTL host as soon as its final lease is released', async () => {
    const manager = new ProviderRuntimeHostManager()
    const disposeResource = vi.fn()
    const lease = await manager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'target-1',
      scopeId: 'provider-target-diagnostics:target-1',
      ttlMs: 0,
      createResource: () => ({ pid: 1234 }),
      disposeResource,
    })

    lease.release()

    expect(disposeResource).toHaveBeenCalledWith({ pid: 1234 })
    expect(manager.listHosts()).toEqual([])
  })
})
