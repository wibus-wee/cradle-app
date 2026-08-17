import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildUpstreamRequestHeaders,
  buildUpstreamResponseHeaders,
  proxyUpstreamRequestWithReconnect,
  upstreamJsonByBaseUrl,
} from '../../http/upstream'

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

  it('replays a failed GET once after resolving a reconnected tunnel', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('socket hang up'))
      .mockResolvedValueOnce(new Response('recovered', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const resolveBaseUrl = vi.fn()
      .mockResolvedValueOnce('http://127.0.0.1:4101')
      .mockResolvedValueOnce('http://127.0.0.1:4102')

    const response = await proxyUpstreamRequestWithReconnect(
      resolveBaseUrl,
      new Request('http://localhost/remote-hosts/host/upstream/health'),
      '/health',
    )

    expect(await response.text()).toBe('recovered')
    expect(resolveBaseUrl).toHaveBeenCalledTimes(2)
    expect(resolveBaseUrl.mock.calls).toEqual([
      [undefined],
      ['http://127.0.0.1:4101'],
    ])
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      'http://127.0.0.1:4101/health',
      'http://127.0.0.1:4102/health',
    ])
  })

  it('does not replay a mutation after a transport hangup', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('socket hang up'))
    vi.stubGlobal('fetch', fetchMock)
    const resolveBaseUrl = vi.fn().mockResolvedValue('http://127.0.0.1:4101')

    await expect(proxyUpstreamRequestWithReconnect(
      resolveBaseUrl,
      new Request('http://localhost/remote-hosts/host/upstream/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: 'one execution only' }),
        headers: { 'content-type': 'application/json' },
      }),
      '/sessions',
    )).rejects.toMatchObject({ code: 'remote_cradle_request_failed' })

    expect(resolveBaseUrl).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
