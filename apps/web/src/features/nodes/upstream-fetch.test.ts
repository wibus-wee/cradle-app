import { describe, expect, it, vi } from 'vitest'

import { client } from '~/api-gen/client.gen'

import {
  fetchNodeUpstreamJson,
  nodeUpstreamQueryKey,
} from './upstream-fetch'

vi.mock('~/api-gen/client.gen', () => ({
  client: {
    request: vi.fn(),
  },
}))

describe('fetchNodeUpstreamJson', () => {
  it('calls api-gen client with concrete upstream path and query', async () => {
    vi.mocked(client.request).mockResolvedValueOnce({
      data: [{ id: 'ws-1' }],
      request: new Request('http://example.test'),
      response: new Response(),
    })

    const result = await fetchNodeUpstreamJson<{ id: string }[]>(
      'host-1',
      '/workspaces/ws-1/files/children?path=src',
    )

    expect(result).toEqual([{ id: 'ws-1' }])
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      url: '/nodes/host-1/upstream/workspaces/ws-1/files/children',
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

    await fetchNodeUpstreamJson('host-1', '/providers/models', {
      method: 'POST',
      body: { label: 'x' },
    })

    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: '/nodes/host-1/upstream/providers/models',
      body: { label: 'x' },
      throwOnError: true,
    }))
  })
})

describe('nodeUpstreamQueryKey', () => {
  it('namespaces by node and path parts', () => {
    expect(nodeUpstreamQueryKey('h1', 'workspaces')).toEqual([
      'node-upstream',
      'h1',
      'workspaces',
    ])
  })
})
