import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildUpstreamRequestHeaders, buildUpstreamResponseHeaders, upstreamJsonByBaseUrl } from './upstream'

describe('remote-host upstream helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  it('preserves safe Cradle error identity without forwarding arbitrary details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'invalid_session_input',
      message: 'Session requires a provider target or an agent',
      details: { apiKey: 'must-not-leak' },
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })))

    await expect(upstreamJsonByBaseUrl('http://remote.test', '/sessions')).rejects.toMatchObject({
      code: 'remote_cradle_http_error',
      message: 'Remote Cradle Server returned HTTP 400 for /sessions. Session requires a provider target or an agent',
      details: {
        path: '/sessions',
        status: 400,
        upstreamCode: 'invalid_session_input',
        upstreamMessage: 'Session requires a provider target or an agent',
      },
    })
  })
})
