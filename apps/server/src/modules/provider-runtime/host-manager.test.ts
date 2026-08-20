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

  it('collects every active resource for a runtime kind', async () => {
    const manager = new ProviderRuntimeHostManager()
    const disposeResource = vi.fn()
    const firstLease = await manager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'target-1',
      scopeId: 'chat-session:session-1',
      retainOnRelease: true,
      createResource: () => ({ pid: 1234 }),
      disposeResource,
    })
    const secondLease = await manager.acquireResource({
      runtimeKind: 'codex',
      providerTargetId: 'target-2',
      scopeId: 'chat-session:session-2',
      retainOnRelease: true,
      createResource: () => ({ pid: 5678 }),
      disposeResource,
    })

    expect(manager.collectResources('codex', (resource, host) => ({
      hostId: host.hostId,
      resource,
    }))).toEqual([
      { hostId: 'codex:target-1:chat-session:session-1', resource: { pid: 1234 } },
      { hostId: 'codex:target-2:chat-session:session-2', resource: { pid: 5678 } },
    ])

    firstLease.release()
    secondLease.release()
    await manager.clear()
  })

  it('does not let a stale process generation invalidate its replacement', async () => {
    const manager = new ProviderRuntimeHostManager()
    let generation = 0
    const input = {
      runtimeKind: 'codex',
      providerTargetId: 'target-1',
      scopeId: 'provider-host',
      retainOnRelease: true,
      createResource: () => ({ generation: ++generation }),
      disposeResource: vi.fn(),
    }

    const first = await manager.acquireResource(input)
    const hostId = first.hostId
    const firstResource = first.resource
    first.release()
    await manager.invalidateResource(hostId, firstResource)

    const second = await manager.acquireResource(input)
    expect(second.resource).toEqual({ generation: 2 })
    await manager.invalidateResource(hostId, firstResource)
    expect(manager.listHosts()).toEqual([
      expect.objectContaining({ hostId, hasResource: true }),
    ])

    second.release()
    await manager.clear()
  })
})
