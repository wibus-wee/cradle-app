import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  encodeRemoteAgentFrame,
  REMOTE_AGENT_PROTOCOL_VERSION,
  type RemoteAgentFrame,
} from '@cradle/remote-agent-protocol'
import {
  encodeRelayEnvelope,
  parseRelayEnvelope,
} from '@cradle/remote-relay-protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'

import {
  startAgentdRelayClient,
  startAgentdRelayHostSessionClient,
  type AgentdRelayClient,
  type AgentdRelayHostSessionClient,
} from './relay-client'
import { readRelayProfile, writeRelayProfile } from './relay-profile'

interface FakeRelay {
  url: string
  response: Promise<RemoteAgentFrame>
  close(): Promise<void>
}

interface FakeServer {
  url: string
  close(): Promise<void>
}

describe('Agentd relay client', () => {
  let relay: FakeRelay | null = null
  let server: FakeServer | null = null
  let client: AgentdRelayClient | null = null
  let hostSessionClient: AgentdRelayHostSessionClient | null = null
  let homeDir: string | null = null

  afterEach(async () => {
    await client?.close()
    client = null
    await hostSessionClient?.close()
    hostSessionClient = null
    await server?.close()
    server = null
    await relay?.close()
    relay = null
    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true })
      homeDir = null
    }
  })

  it('dispatches a remote-agent frame received through a relay envelope', async () => {
    relay = await startFakeRelay()
    homeDir = mkdtempSync(join(tmpdir(), 'cradle-agentd-relay-'))
    client = await startAgentdRelayClient({
      homeDir,
      relayUrl: relay.url,
      pairingToken: 'pairing-token',
      hostToken: 'host-token',
      roomId: 'room_agentd_relay',
    })

    const response = await relay.response

    expect(response).toEqual(expect.objectContaining({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'rpc.response',
      id: 'rpc_hello',
      result: expect.objectContaining({
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        daemonVersion: '0.1.0',
      }),
    }))
  })

  it('persists relay profiles under the agentd home directory', () => {
    homeDir = mkdtempSync(join(tmpdir(), 'cradle-agentd-profile-'))

    writeRelayProfile(homeDir, 'default', {
      serverUrl: 'http://127.0.0.1:3000',
      relayUrl: 'http://127.0.0.1:8787',
      enrollmentId: 'enrollment-1',
      enrollmentSecret: 'secret-1',
    })

    expect(readRelayProfile(homeDir, 'default')).toEqual({
      serverUrl: 'http://127.0.0.1:3000',
      relayUrl: 'http://127.0.0.1:8787',
      enrollmentId: 'enrollment-1',
      enrollmentSecret: 'secret-1',
    })
  })

  it('starts a persistent relay host session from a server enrollment', async () => {
    relay = await startFakeRelay()
    server = await startFakeServer(relay.url)
    homeDir = mkdtempSync(join(tmpdir(), 'cradle-agentd-relay-session-'))

    hostSessionClient = await startAgentdRelayHostSessionClient({
      homeDir,
      serverUrl: server.url,
      enrollmentId: 'enrollment-1',
      enrollmentSecret: 'secret-1',
    })

    const response = await relay.response

    expect(hostSessionClient.roomId).toBe('room_agentd_relay')
    expect(response).toEqual(expect.objectContaining({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'rpc.response',
      id: 'rpc_hello',
      result: expect.objectContaining({
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        daemonVersion: '0.1.0',
      }),
    }))
  })
})

async function startFakeRelay(): Promise<FakeRelay> {
  let hostSocket: WebSocket | null = null
  let resolveResponse!: (frame: RemoteAgentFrame) => void
  let rejectResponse!: (error: Error) => void
  const response = new Promise<RemoteAgentFrame>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })

  const httpServer = createServer(async (request, res) => {
    if (request.method === 'POST' && request.url === '/rooms/host-session') {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        hostToken?: string
      }
      if (request.headers.authorization !== 'Bearer room-start-token' || body.hostToken !== 'host-token') {
        res.writeHead(401)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        roomId: 'room_agentd_relay',
        hostToken: 'host-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }))
      return
    }
    if (request.method !== 'POST' || request.url !== '/pairing/start') {
      res.writeHead(404)
      res.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      hostToken?: string
      roomId?: string
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      roomId: body.roomId ?? 'room_agentd_relay',
      pairingCode: 'ABCD-1234',
      hostToken: body.hostToken ?? 'host-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }))
  })
  const socketServer = new WebSocketServer({ server: httpServer })
  socketServer.on('connection', (socket) => {
    hostSocket = socket
    socket.on('message', (raw) => {
      try {
        const envelope = parseRelayEnvelope(raw.toString())
        resolveResponse(envelope.payload as RemoteAgentFrame)
      }
      catch (error) {
        rejectResponse(error instanceof Error ? error : new Error(String(error)))
      }
    })
    const payload = JSON.parse(encodeRemoteAgentFrame({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'rpc.request',
      id: 'rpc_hello',
      method: 'host/hello',
      params: { clientName: 'fake-relay' },
    }))
    socket.send(encodeRelayEnvelope({
      version: 1,
      roomId: 'room_agentd_relay',
      seq: 1,
      kind: 'remote_agent_frame',
      payload,
    }))
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject)
      resolve()
    })
  })
  const address = httpServer.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    response,
    close: async () => {
      hostSocket?.close()
      await new Promise<void>((resolve, reject) => {
        socketServer.close()
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

async function startFakeServer(relayUrl: string): Promise<FakeServer> {
  const httpServer = createServer(async (request, res) => {
    if (request.method !== 'POST' || request.url !== '/remote-hosts/relay/enrollments/enrollment-1/host-session') {
      res.writeHead(404)
      res.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      enrollmentSecret?: string
    }
    if (body.enrollmentSecret !== 'secret-1') {
      res.writeHead(401)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      relayUrl,
      roomId: 'room_agentd_relay',
      roomStartToken: 'room-start-token',
      hostToken: 'host-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }))
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject)
      resolve()
    })
  })
  const address = httpServer.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}
