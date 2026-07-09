import { describe, expect, it } from 'vitest'

import {
  isRemoteHostConnectionBlocking,
  resolveRemoteHostConnectionGate,
} from './use-remote-host-connection'

describe('resolveRemoteHostConnectionGate', () => {
  const hosts = [
    {
      id: 'host-1',
      displayName: 'Studio',
      enabled: true,
      lastSeenAt: null,
      connectionState: 'connected' as const,
      lastError: null,
      connectionConfigJson: '{}',
      capabilitiesJson: '{}',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'host-2',
      displayName: 'Laptop',
      enabled: true,
      lastSeenAt: null,
      connectionState: 'idle' as const,
      lastError: null,
      connectionConfigJson: '{}',
      capabilitiesJson: '{}',
      createdAt: 1,
      updatedAt: 1,
    },
  ]

  it('returns local when no host id is provided', () => {
    expect(resolveRemoteHostConnectionGate({ hostId: null, hosts })).toEqual({ kind: 'local' })
  })

  it('returns connected / disconnected / unknown-host', () => {
    expect(resolveRemoteHostConnectionGate({ hostId: 'host-1', hosts })).toMatchObject({
      kind: 'connected',
      hostId: 'host-1',
    })
    expect(resolveRemoteHostConnectionGate({ hostId: 'host-2', hosts })).toMatchObject({
      kind: 'disconnected',
      hostId: 'host-2',
    })
    expect(resolveRemoteHostConnectionGate({ hostId: 'missing', hosts })).toEqual({
      kind: 'unknown-host',
      hostId: 'missing',
    })
  })

  it('blocks disconnected and unknown hosts', () => {
    expect(isRemoteHostConnectionBlocking({ kind: 'local' })).toBe(false)
    expect(isRemoteHostConnectionBlocking({
      kind: 'connected',
      hostId: 'host-1',
      host: hosts[0]!,
    })).toBe(false)
    expect(isRemoteHostConnectionBlocking({
      kind: 'disconnected',
      hostId: 'host-2',
      host: hosts[1]!,
    })).toBe(true)
    expect(isRemoteHostConnectionBlocking({ kind: 'unknown-host', hostId: 'x' })).toBe(true)
  })
})
