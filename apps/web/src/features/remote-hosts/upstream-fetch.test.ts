import { describe, expect, it, vi } from 'vitest'

import { client } from '~/api-gen/client.gen'

import {
  fetchRemoteUpstreamJson,
  remoteHostUpstreamQueryKey,
} from './upstream-fetch'

vi.mock('~/api-gen/client.gen', () => ({
  client: {
    request: vi.fn(),
  },
}))

describe('fetchRemoteUpstreamJson', () => {
  it('calls api-gen client with concrete upstream path and query', async () => {
    vi.mocked(client.request).mockResolvedValueOnce({
      data: [{ id: 'ws-1' }],
      request: new Request('http://example.test'),
      response: new Response(),
    })

    const result = await fetchRemoteUpstreamJson<{ id: string }[]>(
      'host-1',
      '/workspaces/ws-1/files/children?path=src',
    )

    expect(result).toEqual([{ id: 'ws-1' }])
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      url: '/remote-hosts/host-1/upstream/workspaces/ws-1/files/children',
      query: { path: 'src' },
      throwOnError: true,
    }))
  })

  it('forwards POST body through the generated client', async () => {
    vi.mocked(client.request).mockResolvedValueOnce({
      data: { ok: true },
      request: new Request('http://example.test'),
      response: new Response(),
    })

    await fetchRemoteUpstreamJson('host-1', '/providers/models', {
      method: 'POST',
      body: { label: 'x' },
    })

    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: '/remote-hosts/host-1/upstream/providers/models',
      body: { label: 'x' },
      throwOnError: true,
    }))
  })
})

describe('remoteHostUpstreamQueryKey', () => {
  it('namespaces by host and path parts', () => {
    expect(remoteHostUpstreamQueryKey('h1', 'workspaces')).toEqual([
      'remote-host-upstream',
      'h1',
      'workspaces',
    ])
  })
})
