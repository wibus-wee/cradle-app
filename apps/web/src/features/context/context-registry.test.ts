import { describe, expect, it } from 'vitest'

import { createContextRegistry, installContextProviders } from './context-registry'

describe('renderer context registry', () => {
  it('collects provider items into a typed envelope with active surface metadata', () => {
    const registry = createContextRegistry({
      readActiveSurface: () => ({ id: 'chat:session-1', type: 'chat', params: { sessionId: 'session-1' }, search: {} }),
      readNow: () => 1779781200000,
      createEnvelopeId: now => `ctx-test-${now}`,
    })

    registry.setProvider({
      owner: 'chat',
      readContext: input => [{
        id: `chat:attention:${input.activeSurfaceId}`,
        kind: 'attention',
        owner: 'chat',
        title: 'Chat attention',
        summary: 'User is viewing historical messages.',
        priority: 90,
        freshness: 'live',
        sensitivity: 'private',
        tokenEstimate: 8,
        createdAt: input.now,
      }],
    })

    expect(registry.collectEnvelope()).toEqual({
      id: 'ctx-test-1779781200000',
      capturedAt: 1779781200000,
      activeSurfaceId: 'chat:session-1',
      activeSurfaceType: 'chat',
      activeSurfaceParams: { sessionId: 'session-1' },
      activeSurfaceSearch: {},
      items: [{
        id: 'chat:attention:chat:session-1',
        kind: 'attention',
        owner: 'chat',
        title: 'Chat attention',
        summary: 'User is viewing historical messages.',
        priority: 90,
        freshness: 'live',
        sensitivity: 'private',
        tokenEstimate: 8,
        createdAt: 1779781200000,
      }],
    })
  })

  it('replaces providers by owner and keeps stale disposers from deleting newer providers', () => {
    const registry = createContextRegistry({
      readActiveSurface: () => ({ id: null, type: null }),
      readNow: () => 1779781200000,
      createEnvelopeId: now => `ctx-test-${now}`,
    })
    const firstRegistration = registry.setProvider({
      owner: 'system-agent',
      readContext: input => [{
        id: 'system-agent:first',
        kind: 'view',
        owner: 'system-agent',
        title: 'First provider',
        summary: 'First provider.',
        priority: 10,
        freshness: 'live',
        sensitivity: 'public',
        tokenEstimate: 1,
        createdAt: input.now,
      }],
    })
    const secondRegistration = registry.setProvider({
      owner: 'system-agent',
      readContext: input => [{
        id: 'system-agent:second',
        kind: 'view',
        owner: 'system-agent',
        title: 'Second provider',
        summary: 'Second provider.',
        priority: 20,
        freshness: 'live',
        sensitivity: 'public',
        tokenEstimate: 1,
        createdAt: input.now,
      }],
    })

    firstRegistration.dispose()
    expect(registry.collectEnvelope().items.map(item => item.id)).toEqual(['system-agent:second'])

    secondRegistration.dispose()
    expect(registry.collectEnvelope().items).toEqual([])
  })

  it('rejects duplicate owners in one provider installation list before installation', () => {
    const registry = createContextRegistry({
      readActiveSurface: () => ({ id: null, type: null }),
    })
    const provider = {
      owner: 'chat',
      readContext: () => [],
    }

    expect(() => installContextProviders([provider, provider], registry)).toThrow('Duplicate context provider owner: chat')
    expect(registry.collectEnvelope().items).toEqual([])
  })

  it('installs provider lists and disposes the installed generation only', () => {
    const registry = createContextRegistry({
      readActiveSurface: () => ({ id: null, type: null }),
      readNow: () => 1779781200000,
      createEnvelopeId: now => `ctx-test-${now}`,
    })
    const disposeFirst = installContextProviders([{
      owner: 'chat',
      readContext: input => [{
        id: 'chat:first',
        kind: 'attention',
        owner: 'chat',
        title: 'First chat provider',
        summary: 'First chat provider.',
        priority: 10,
        freshness: 'live',
        sensitivity: 'private',
        tokenEstimate: 1,
        createdAt: input.now,
      }],
    }], registry)
    const disposeSecond = installContextProviders([{
      owner: 'chat',
      readContext: input => [{
        id: 'chat:second',
        kind: 'attention',
        owner: 'chat',
        title: 'Second chat provider',
        summary: 'Second chat provider.',
        priority: 20,
        freshness: 'live',
        sensitivity: 'private',
        tokenEstimate: 1,
        createdAt: input.now,
      }],
    }], registry)

    disposeFirst()
    expect(registry.collectEnvelope().items.map(item => item.id)).toEqual(['chat:second'])

    disposeSecond()
    expect(registry.collectEnvelope().items).toEqual([])
  })
})
