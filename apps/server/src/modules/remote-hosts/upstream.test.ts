import { describe, expect, it } from 'vitest'

import { filterHopByHopRequestHeaders } from './upstream'

describe('remote-host upstream helpers', () => {
  it('rewrites host and strips hop-by-hop request headers', () => {
    const headers = new Headers({
      'connection': 'keep-alive',
      'host': 'localhost:21423',
      'x-test': 'value',
    })
    const filtered = filterHopByHopRequestHeaders(headers, '127.0.0.1:9999')
    expect(filtered.get('host')).toBe('127.0.0.1:9999')
    expect(filtered.get('x-test')).toBe('value')
    expect(filtered.get('connection')).toBeNull()
  })
})
