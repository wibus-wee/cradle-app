import { once } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

import { createKimiWebSocketClient } from './client'

describe('kimi WebSocket client', () => {
  const servers: WebSocketServer[] = []

  afterEach(async () => {
    await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  })

  it('restores subscriptions after reconnecting and forwards resync_required', async () => {
    const server = new WebSocketServer({ port: 0 })
    servers.push(server)
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const frames: Array<{ type: string, payload: { subscriptions?: string[], session_id?: string } }> = []
    const connections: import('ws').WebSocket[] = []
    server.on('connection', (socket) => {
      connections.push(socket)
      socket.on('message', raw => frames.push(JSON.parse(raw.toString())))
    })

    const client = await createKimiWebSocketClient({ baseUrl: `http://127.0.0.1:${port}`, bearerToken: 'test' })
    const events: string[] = []
    const unsubscribe = client.subscribe('session-1', event => events.push(event.type))
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'subscribe')).toBe(true))

    connections[0]!.send(JSON.stringify({
      type: 'resync_required',
      timestamp: '2026-07-21T00:00:00.000Z',
      payload: { session_id: 'session-1', reason: 'buffer_overflow', current_seq: 9 },
    }))
    await vi.waitFor(() => expect(events).toEqual(['resync_required']))

    connections[0]!.close()
    await vi.waitFor(() => expect(connections).toHaveLength(2))
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'client_hello' && frame.payload.subscriptions?.includes('session-1'))).toBe(true))

    unsubscribe()
    await client.close()
  })
})
