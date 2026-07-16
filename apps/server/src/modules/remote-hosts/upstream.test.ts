import { describe, expect, it } from 'vitest'

import { buildUpstreamRequestHeaders, buildUpstreamResponseHeaders } from './upstream'

describe('remote-host upstream helpers', () => {
  it('rebuilds upstream headers from the protocol allowlist', () => {
    const headers = new Headers({
      'authorization': 'Bearer local-control-token',
      'connection': 'keep-alive',
      'content-type': 'application/json',
      'cookie': 'session=local',
      'host': 'localhost:21423',
      'x-cradle-relay-token': 'relay-token',
      'x-cradle-token': 'local-token',
      'x-test': 'value',
    })
    const filtered = buildUpstreamRequestHeaders(headers, '127.0.0.1:9999')
    expect(filtered.get('host')).toBe('127.0.0.1:9999')
    expect(filtered.get('content-type')).toBe('application/json')
    expect(filtered.get('authorization')).toBeNull()
    expect(filtered.get('cookie')).toBeNull()
    expect(filtered.get('connection')).toBeNull()
    expect(filtered.get('x-cradle-relay-token')).toBeNull()
    expect(filtered.get('x-cradle-token')).toBeNull()
    expect(filtered.get('x-test')).toBeNull()
  })

  it('keeps payload headers but removes transport and upstream CORS headers', () => {
    const headers = new Headers({
      'access-control-allow-credentials': 'true',
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'x-upstream-id',
      'access-control-allow-private-network': 'true',
      'cache-control': 'no-store',
      'connection': 'keep-alive',
      'content-type': 'application/json',
      'x-upstream-id': 'remote-1',
    })

    const filtered = buildUpstreamResponseHeaders(headers)

    expect(filtered.get('cache-control')).toBe('no-store')
    expect(filtered.get('content-type')).toBe('application/json')
    expect(filtered.get('x-upstream-id')).toBe('remote-1')
    expect(filtered.get('connection')).toBeNull()
    expect(filtered.get('access-control-allow-credentials')).toBeNull()
    expect(filtered.get('access-control-allow-origin')).toBeNull()
    expect(filtered.get('access-control-expose-headers')).toBeNull()
    expect(filtered.get('access-control-allow-private-network')).toBeNull()
  })
})
