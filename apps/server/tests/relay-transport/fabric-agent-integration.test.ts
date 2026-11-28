import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fabricMembership } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'

import { db, shutdownInfra } from '../../src/infra'
import type { MembershipCertificate } from '../../src/modules/fabric/protocol'
import {
  fabricAuthHeaders,
  generateFabricEncryptionKeyPair,
  generateFabricSigningKeyPair,
  signFabricCertificate,
} from '../../src/modules/fabric/protocol'
import { startRelayControllerTransport } from '../../src/modules/relay-transport/controller-transport'
import { decodeFabricEnvelope, encodeFabricEnvelope } from '../../src/modules/relay-transport/fabric-envelope'
import type { FabricIpcAuthFrame } from '../../src/modules/relay-transport/ipc-envelope-pipe'
import { encodeFabricIpcFrame, FabricIpcFrameParser } from '../../src/modules/relay-transport/ipc-envelope-pipe'
import { FabricNodeConnector } from '../../src/modules/relay-transport/node-connector'
import { upsertSecret } from '../../src/modules/secrets/service'

const IPC_TOKEN = 'integration-ipc-token'

function waitFor(condition: () => boolean, timeoutMs = 10_000, label = 'condition'): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      if (condition()) {
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for ${label}`))
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })
}

/**
 * Minimal relayd: directory endpoints needed by the connector plus the two
 * WebSocket carriage endpoints, routing envelopes between the node-role
 * socket and per-link controller sockets by their cleartext linkId — the
 * same byte-transparent scheduling contract as real relayd.
 */
function startFakeRelayd(controllerCertificatePayload: () => Buffer) {
  const nodeSockets = new Set<WebSocket>()
  const linkSockets = new Map<string, WebSocket>()
  const upgrades: string[] = []
  const wss = new WebSocketServer({ noServer: true })

  const http: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'POST' && url.pathname === '/v1/fabrics/fabric-1/controllers') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{}')
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"error":"not found"}')
  })

  http.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    upgrades.push(pathname)
    wss.handleUpgrade(request, socket, head, (ws) => {
      if (pathname === '/v1/ws/nodes') {
        nodeSockets.add(ws)
        ws.on('close', () => nodeSockets.delete(ws))
        ws.on('message', (data) => {
          try {
            const envelope = decodeFabricEnvelope(new Uint8Array((data as Buffer).buffer, (data as Buffer).byteOffset, (data as Buffer).byteLength))
            linkSockets.get(envelope.linkId)?.send(data)
          }
 catch {
            ws.close(1008, 'invalid frame')
          }
        })
        return
      }
      const controllerMatch = /^\/v1\/ws\/controllers\/(?<linkId>[^/]+)$/u.exec(pathname)
      if (controllerMatch?.groups?.linkId) {
        const linkId = decodeURIComponent(controllerMatch.groups.linkId)
        linkSockets.set(linkId, ws)
        ws.on('close', () => {
          if (linkSockets.get(linkId) === ws) {
            linkSockets.delete(linkId)
          }
        })
        ws.on('message', (data) => {
          for (const nodeSocket of nodeSockets) {
            nodeSocket.send(data)
          }
        })
      }
    })
  })

  return new Promise<{
    port: number
    relayUrl: string
    upgrades: string[]
    nodeSocketCount: () => number
    sendLinkOpen: (linkId: string) => Promise<void>
    close: () => Promise<void>
  }>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', () => {
      const { port } = http.address() as AddressInfo
      resolve({
        port,
        relayUrl: `http://127.0.0.1:${port}`,
        upgrades,
        nodeSocketCount: () => nodeSockets.size,
        sendLinkOpen: async (linkId) => {
          const envelope = encodeFabricEnvelope(
            { fabricId: 'fabric-1', nodeId: 'node-local', linkId },
            { seq: 1, kind: 'link_open', priority: 'control', payload: controllerCertificatePayload() },
          )
          const socket = [...nodeSockets][0]
          if (!socket) {
            throw new Error('no node socket connected')
          }
          await new Promise<void>((done, fail) => {
            socket.send(envelope, error => error ? fail(error) : done())
          })
        },
        close: () => new Promise((done) => {
          for (const socket of nodeSockets) {
            socket.terminate()
          }
          for (const socket of linkSockets.values()) {
            socket.terminate()
          }
          wss.close()
          http.close(() => done())
        }),
      })
    })
  })
}

/**
 * Fake fabric agent implementing the IPC contract faithfully: validate the
 * token, dial the upstream relayd WebSocket named inside each auth frame
 * for its role and route, then pipe frames byte-transparently in both directions. Upstream
 * death closes the IPC connection and vice versa — no replay.
 */
function startFakeAgent() {
  const auths: FabricIpcAuthFrame[] = []
  const relayedBytes = { ipcToUpstream: 0, upstreamToIpc: 0 }
  const sockets = new Set<net.Socket>()
  const server = net.createServer((ipc) => {
    sockets.add(ipc)
    ipc.once('close', () => sockets.delete(ipc))
    const parser = new FabricIpcFrameParser()
    let upstream: WebSocket | null = null
    let authenticated = false
    const queued: Buffer[] = []
    ipc.on('data', (chunk) => {
      let frames: Uint8Array[]
      try {
        frames = parser.push(chunk)
      }
 catch {
        ipc.destroy()
        return
      }
      for (const frame of frames) {
        if (!authenticated) {
          let auth: FabricIpcAuthFrame
          try {
            auth = JSON.parse(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).toString('utf8')) as FabricIpcAuthFrame
          }
 catch {
            ipc.destroy()
            return
          }
          if (auth.token !== IPC_TOKEN) {
            ipc.destroy()
            return
          }
          authenticated = true
          auths.push(auth)
          const path = auth.role === 'node'
            ? '/v1/ws/nodes'
            : `/v1/ws/controllers/${encodeURIComponent(auth.linkId ?? '')}`
          const wsUrl = new URL(path, `${auth.relayUrl.replace(/\/+$/, '')}/`)
          wsUrl.protocol = 'ws:'
          upstream = new WebSocket(wsUrl, { headers: auth.headers })
          upstream.on('open', () => {
            for (const payload of queued.splice(0)) {
              upstream?.send(payload)
            }
          })
          upstream.on('message', (data) => {
            const payload = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[])
            relayedBytes.upstreamToIpc += payload.byteLength
            ipc.write(encodeFabricIpcFrame(payload))
          })
          upstream.on('close', () => ipc.destroy())
          upstream.on('error', () => ipc.destroy())
          continue
        }
        relayedBytes.ipcToUpstream += frame.byteLength
        const payload = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)
        if (upstream?.readyState === WebSocket.OPEN) {
          upstream.send(payload)
        }
 else {
          queued.push(payload)
        }
      }
    })
    ipc.on('close', () => upstream?.terminate())
    ipc.on('error', () => upstream?.terminate())
  })

  return new Promise<{
    port: number
    auths: FabricIpcAuthFrame[]
    relayedBytes: { ipcToUpstream: number, upstreamToIpc: number }
    close: () => Promise<void>
  }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        port,
        auths,
        relayedBytes,
        close: () => new Promise((done) => {
          for (const socket of sockets) {
            socket.destroy()
          }
          server.close(() => done())
        }),
      })
    })
  })
}

interface SeededFabric {
  nodeEncryption: { privateKeyBase64: string, publicKeyBase64: string }
  controllerIdentity: { privateKeyBase64: string, publicKeyBase64: string }
  controllerEncryption: { privateKeyBase64: string, publicKeyBase64: string }
  controllerCertificate: MembershipCertificate
}

function seedFabric(relayUrl: string): SeededFabric {
  const owner = generateFabricSigningKeyPair()
  const nodeIdentity = generateFabricSigningKeyPair()
  const nodeEncryption = generateFabricEncryptionKeyPair()
  const controllerIdentity = generateFabricSigningKeyPair()
  const controllerEncryption = generateFabricEncryptionKeyPair()
  const nodeCertificate = signFabricCertificate(owner.privateKeyBase64, {
    fabricId: 'fabric-1',
    subjectKind: 'node',
    subjectId: 'node-local',
    identityPubkey: nodeIdentity.publicKeyBase64,
    encryptionPubkey: nodeEncryption.publicKeyBase64,
    scopes: ['admin'],
  })
  const controllerCertificate = signFabricCertificate(owner.privateKeyBase64, {
    fabricId: 'fabric-1',
    subjectKind: 'controller',
    subjectId: 'controller-1',
    identityPubkey: controllerIdentity.publicKeyBase64,
    encryptionPubkey: controllerEncryption.publicKeyBase64,
    scopes: ['control', 'view'],
  })
  upsertSecret({ id: 'fabric-owner-itest', kind: 'system-fabric-owner-key', label: 'owner', secret: owner.privateKeyBase64 })
  upsertSecret({ id: 'fabric-identity-itest', kind: 'system-fabric-identity-key', label: 'identity', secret: nodeIdentity.privateKeyBase64 })
  upsertSecret({ id: 'fabric-encryption-itest', kind: 'system-fabric-encryption-key', label: 'encryption', secret: nodeEncryption.privateKeyBase64 })
  db().insert(fabricMembership).values({
    fabricId: 'fabric-1',
    relayUrl,
    localNodeId: 'node-local',
    role: 'owner',
    ownerKeySecretId: 'fabric-owner-itest',
    identityKeySecretId: 'fabric-identity-itest',
    encryptionKeySecretId: 'fabric-encryption-itest',
    certificateJson: JSON.stringify({ node: nodeCertificate, controller: controllerCertificate }),
    createdAt: 1,
    updatedAt: 1,
  }).run()
  return { nodeEncryption, controllerIdentity, controllerEncryption, controllerCertificate }
}

describe('fabric node connector over fabric-agent IPC', () => {
  const cleanups: Array<() => Promise<void> | void> = []
  let dataDir = ''
  const previousLocator = process.env.CRADLE_FABRIC_AGENT_LOCATOR
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup()
    }
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_FABRIC_AGENT_LOCATOR', previousLocator)
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CRADLE_CREDENTIAL_SECRET', previousCredentialSecret)
  })

  it('carries a full encrypted envelope round trip through the agent pipe', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-ipc-itest-'))
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'fabric-ipc-integration-secret'

    // The node-facing echo server stands in for this machine's Cradle Server
    // HTTP port: the connector terminates streams as loopback TCP to it.
    const echo = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'connection': 'close' })
      response.end(`fabric-echo:${request.url ?? ''}`)
    })
    await new Promise<void>((resolve, reject) => {
      echo.once('error', reject)
      echo.listen(0, '127.0.0.1', resolve)
    })
    cleanups.push(() => new Promise<void>(resolve => echo.close(() => resolve())))
    const echoPort = (echo.address() as AddressInfo).port

    const seededHolder: { seeded: SeededFabric | null } = { seeded: null }
    const relayd = await startFakeRelayd(() => Buffer.from(JSON.stringify(seededHolder.seeded!.controllerCertificate)))
    cleanups.push(() => relayd.close())

    const seeded = seedFabric(relayd.relayUrl)
    seededHolder.seeded = seeded

    const agent = await startFakeAgent()
    cleanups.push(() => agent.close())

    // Locator + token exactly as the contract lays them out: JSON locator
    // next to a mode-0600 token file, token never on a command line.
    writeFileSync(join(dataDir, 'ipc-token'), IPC_TOKEN, { mode: 0o600 })
    const locatorPath = join(dataDir, 'agent.json')
    writeFileSync(locatorPath, JSON.stringify({ version: 1, port: agent.port, tokenFile: 'ipc-token', pid: process.pid }), { mode: 0o600 })
    process.env.CRADLE_FABRIC_AGENT_LOCATOR = locatorPath

    const connector = new FabricNodeConnector('127.0.0.1', echoPort)
    cleanups.push(() => connector.stop())
    connector.start()

    // The node pipe comes up through the agent, not a direct WebSocket.
    await waitFor(() => agent.auths.some(auth => auth.role === 'node'), 10_000, 'node-role IPC auth')
    await waitFor(() => relayd.nodeSocketCount() === 1, 10_000, 'agent upstream node socket')

    const linkId = 'link-ipc-1'
    await relayd.sendLinkOpen(linkId)

    const controllerHeaders = fabricAuthHeaders(
      seeded.controllerCertificate,
      seeded.controllerIdentity.privateKeyBase64,
      'GET',
      `/v1/ws/controllers/${linkId}`,
    )
    const transport = await startRelayControllerTransport({
      relayUrl: relayd.relayUrl,
      readyTimeoutMs: 10_000,
      controllerPrivateKeyBase64: seeded.controllerEncryption.privateKeyBase64,
      controllerPublicKeyBase64: seeded.controllerEncryption.publicKeyBase64,
      nodePublicKeyBase64: seeded.nodeEncryption.publicKeyBase64,
      fabric: { fabricId: 'fabric-1', nodeId: 'node-local', linkId, headers: controllerHeaders },
    })
    cleanups.push(() => transport.close())

    const response = await fetch(`${transport.localBaseUrl}/workspace/probe?via=fabric-ipc`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('fabric-echo:/workspace/probe?via=fabric-ipc')

    // Both carriage roles traveled the IPC pipe: node and controller auth
    // frames reached the agent, relayd saw exactly the two agent-bridged
    // upstreams, and bytes actually flowed through the bridge.
    const roles = agent.auths.map(auth => auth.role).sort()
    expect(roles).toEqual(['controller', 'node'])
    expect(relayd.upgrades.sort()).toEqual([`/v1/ws/controllers/${linkId}`, '/v1/ws/nodes'].sort())
    expect(agent.relayedBytes.ipcToUpstream).toBeGreaterThan(0)
    expect(agent.relayedBytes.upstreamToIpc).toBeGreaterThan(0)

    // Auth frames carry the route and header contract verbatim.
    const nodeAuth = agent.auths.find(auth => auth.role === 'node')!
    expect(nodeAuth.fabricId).toBe('fabric-1')
    expect(nodeAuth.nodeId).toBe('node-local')
    expect(nodeAuth.linkId).toBeUndefined()
    expect(nodeAuth.headers['x-cradle-fabric-certificate']).toBeTruthy()
    expect(nodeAuth.headers['x-cradle-fabric-proof']).toBeTruthy()
    const controllerAuth = agent.auths.find(auth => auth.role === 'controller')!
    expect(controllerAuth.linkId).toBe(linkId)
  }, 30_000)
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  }
 else {
    process.env[name] = value
  }
}
