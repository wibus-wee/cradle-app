import { once } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

import { createKimiWebSocketClient, requiresKimiTranscriptHydration } from './client'

describe('requiresKimiTranscriptHydration', () => {
  it('hydrates when the current prompt reaches a terminal state', () => {
    expect(requiresKimiTranscriptHydration({
      type: 'transcript.ops',
      payload: {
        agent_id: 'main',
        ops: [{
          op: 'prompt.upsert',
          prompt: {
            promptId: 'prompt-1',
            createdAt: '2026-07-29T00:00:00.000Z',
            status: 'completed',
          },
        }],
        seq: 8,
      },
    }, 'prompt-1')).toBe(true)
  })

  it('ignores a terminal update for another prompt', () => {
    expect(requiresKimiTranscriptHydration({
      type: 'transcript.ops',
      payload: {
        agent_id: 'main',
        ops: [{
          op: 'prompt.upsert',
          prompt: {
            promptId: 'prompt-2',
            createdAt: '2026-07-29T00:00:00.000Z',
            status: 'completed',
          },
        }],
        seq: 8,
      },
    }, 'prompt-1')).toBe(false)
  })

  it('ignores a non-terminal update for the current prompt', () => {
    expect(requiresKimiTranscriptHydration({
      type: 'transcript.ops',
      payload: {
        agent_id: 'main',
        ops: [{
          op: 'prompt.upsert',
          prompt: {
            promptId: 'prompt-1',
            createdAt: '2026-07-29T00:00:00.000Z',
            status: 'running',
          },
        }],
        seq: 8,
      },
    }, 'prompt-1')).toBe(false)
  })
})

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
    const frames: Array<{
      type: string
      id?: string
      payload: {
        subscriptions?: string[]
        session_id?: string
        transcript?: Record<string, string>
        transcript_since?: Record<string, number>
      }
    }> = []
    const connections: import('ws').WebSocket[] = []
    server.on('connection', (socket) => {
      connections.push(socket)
      socket.on('message', raw => frames.push(JSON.parse(raw.toString())))
    })

    const client = await createKimiWebSocketClient({ baseUrl: `http://127.0.0.1:${port}`, bearerToken: 'test' })
    const events: string[] = []
    const unsubscribe = client.subscribe('session-1', event => events.push(event.type))
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'subscribe')).toBe(true))
    await vi.waitFor(() => expect(frames.some(frame =>
      frame.type === 'subscribe_v2'
      && frame.payload.session_id === 'session-1'
      && frame.payload.transcript?.['*'] === 'block')).toBe(true))
    const initialV2 = frames.find(frame => frame.type === 'subscribe_v2')!
    connections[0]!.send(JSON.stringify({
      type: 'ack',
      id: initialV2.id,
      code: 0,
      msg: 'ok',
      payload: {
        accepted: ['main'],
        not_found: [],
        resync_required: [],
        cursors: { main: { seq: 6 } },
      },
    }))
    await vi.waitFor(() => expect(events).toEqual(['transcript.subscription.ready']))

    connections[0]!.send(JSON.stringify({
      type: 'transcript.ops',
      session_id: 'session-1',
      timestamp: '2026-07-21T00:00:00.000Z',
      payload: { agent_id: 'main', ops: [], seq: 7 },
    }))
    await vi.waitFor(() => expect(events).toEqual([
      'transcript.subscription.ready',
      'transcript.ops',
    ]))

    connections[0]!.send(JSON.stringify({
      type: 'resync_required',
      timestamp: '2026-07-21T00:00:00.000Z',
      payload: { session_id: 'session-1', reason: 'buffer_overflow', current_seq: 9 },
    }))
    await vi.waitFor(() => expect(events).toEqual([
      'transcript.subscription.ready',
      'transcript.ops',
      'resync_required',
    ]))

    connections[0]!.close()
    await vi.waitFor(() => expect(connections).toHaveLength(2))
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'client_hello' && frame.payload.subscriptions?.includes('session-1'))).toBe(true))
    await vi.waitFor(() => expect(frames.some(frame =>
      frame.type === 'subscribe_v2'
      && frame.payload.transcript_since?.main === 7)).toBe(true))

    unsubscribe()
    await client.close()
  })
})
