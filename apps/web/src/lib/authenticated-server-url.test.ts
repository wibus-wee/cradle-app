import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getAuthenticatedServerResourceUrl,
  getAuthenticatedServerWebSocketUrl,
} from './authenticated-server-url'

const mocks = vi.hoisted(() => ({
  postAuthResourceTicket: vi.fn(),
  postAuthWebsocketTicket: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', () => mocks)

vi.mock('./electron', () => ({
  getServerUrl: () => 'http://127.0.0.1:21424',
  getServerWebSocketUrl: (
    path: string,
    query?: Record<string, string | number | boolean | null | undefined>,
  ) => {
    const url = new URL(path, 'http://127.0.0.1:21424')
    url.protocol = 'ws:'
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value != null) { url.searchParams.set(key, String(value)) }
    }
    return url.toString()
  },
}))

describe('authenticated Server URLs', () => {
  beforeEach(() => {
    mocks.postAuthResourceTicket.mockReset()
    mocks.postAuthWebsocketTicket.mockReset()
  })

  it('uses the generated SDK to issue a WebSocket ticket', async () => {
    mocks.postAuthWebsocketTicket.mockResolvedValue({ data: { ticket: 'socket-ticket' } })

    await expect(
      getAuthenticatedServerWebSocketUrl('/sync', { fromSeq: 7 }),
    )
      .resolves
      .toBe('ws://127.0.0.1:21424/sync?fromSeq=7&ticket=socket-ticket')
    expect(mocks.postAuthWebsocketTicket).toHaveBeenCalledWith({
      body: { audience: '/sync' },
      throwOnError: true,
    })
  })

  it('uses the generated SDK to issue an exact-path resource ticket', async () => {
    mocks.postAuthResourceTicket.mockResolvedValue({ data: { ticket: 'resource-ticket' } })

    await expect(
      getAuthenticatedServerResourceUrl('/api/plugins/example/web.mjs?revision=2'),
    )
      .resolves
      .toBe('http://127.0.0.1:21424/api/plugins/example/web.mjs?revision=2&resourceTicket=resource-ticket')
    expect(mocks.postAuthResourceTicket).toHaveBeenCalledWith({
      body: { path: '/api/plugins/example/web.mjs' },
      throwOnError: true,
    })
  })
})
