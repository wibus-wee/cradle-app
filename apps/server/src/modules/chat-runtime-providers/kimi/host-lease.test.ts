import { afterEach, describe, expect, it, vi } from 'vitest'

import { providerRuntimeHostManager } from '../../provider-runtime/host-manager'
import {
  kimiProviderTargetHostScopeId,
  stopKimiWebHostForSessionStorage,
} from './host-lease'

afterEach(async () => {
  await providerRuntimeHostManager.clear()
})

describe('kimi host lease scope', () => {
  it('is provider-target scoped and never session scoped', () => {
    const scope = kimiProviderTargetHostScopeId('target-a')
    expect(scope).toBe('provider-target:target-a')
    expect(scope).not.toContain('chat-session')
    expect(scope).toBe(kimiProviderTargetHostScopeId('target-a'))
    expect(scope).not.toBe(kimiProviderTargetHostScopeId('target-b'))
  })

  it('stops the host held only by the cleanup lease and rejects shared hosts', async () => {
    const dispose = vi.fn(async () => {})
    const first = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'kimi',
      providerTargetId: 'target-a',
      scopeId: kimiProviderTargetHostScopeId('target-a'),
      createResource: () => ({ id: 'resource-a' }),
      disposeResource: dispose,
    })

    expect(await stopKimiWebHostForSessionStorage('target-a')).toBe('stopped')
    expect(dispose).toHaveBeenCalledOnce()
    first.release()

    const sharedFirst = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'kimi',
      providerTargetId: 'target-b',
      scopeId: kimiProviderTargetHostScopeId('target-b'),
      createResource: () => ({ id: 'resource-b' }),
      disposeResource: dispose,
    })
    const sharedSecond = await providerRuntimeHostManager.acquireResource({
      runtimeKind: 'kimi',
      providerTargetId: 'target-b',
      scopeId: kimiProviderTargetHostScopeId('target-b'),
      createResource: () => ({ id: 'resource-b' }),
      disposeResource: dispose,
    })

    expect(await stopKimiWebHostForSessionStorage('target-b')).toBe('busy')
    sharedFirst.release()
    sharedSecond.release()
  })
})
