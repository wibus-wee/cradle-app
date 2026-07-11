import { describe, expect, it } from 'vitest'

import { buildUpstreamRequestHeaders } from './upstream'

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
})
