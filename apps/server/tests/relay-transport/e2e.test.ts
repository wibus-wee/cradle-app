import type { ChildProcess } from 'node:child_process'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { connect, createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import {
  fabricAuthHeaders,
  generateFabricEncryptionKeyPair,
  generateFabricSigningKeyPair,
  ownerProofHeaders,
  signFabricCertificate,
  signFabricCreateRequest,
  signFabricJoinRequest,
} from '../../src/modules/fabric/protocol'
import type { SignedRelayAssertion } from '../../src/modules/relay-servers/relay-signature-service'
import {
  createRelayRoomId,
  generateRelaySigningKeyPair,
  relayAssertionHeaders,
  signRelayAssertion,
} from '../../src/modules/relay-servers/relay-signature-service'
import type {
  RelayControllerPerformanceSnapshot,
  RelayStreamCheckpoint,
} from '../../src/modules/relay-transport/controller-transport'
import {
  startRelayControllerTransport,
} from '../../src/modules/relay-transport/controller-transport'
import {
  generateRelayKeyPair,
  relayPublicKeyFingerprint,
} from '../../src/modules/relay-transport/crypto'
import {
  decodeFabricEnvelope,
  encodeFabricEnvelope,
  toRelaySessionEnvelope,
} from '../../src/modules/relay-transport/fabric-envelope'
import { decodeRelayEnvelope } from '../../src/modules/relay-transport/protocol'
import { RelaySession } from '../../src/modules/relay-transport/session'
import { relayWebSocketDataView } from '../../src/modules/relay-transport/websocket-data'

/**
 * End-to-end relay transport test: spawns a REAL relayd subprocess and drives
 * the full controller<->host tunnel through it — pairing, E2E handshake,
 * stream multiplexing, an HTTP request round-trip, and a pinned-pubkey
 * reconnect. This is the only test that exercises the WebSocket wiring against
 * the actual relay.
 */

const moduleDir = fileURLToPath(new URL('.', import.meta.url))
const relaydSourceDir = resolveRelaydSourceDir()
const goAvailable = (() => {
  try {
    execFileSync('go', ['version'], { stdio: 'ignore' })
    return true
  }
 catch {
    return false
  }
})()

interface RelaydHandle {
  relayUrl: string
  child: ChildProcess
  getOutput: () => string
}

function resolveRelaydSourceDir(): string | null {
  const candidates = [
    resolve(process.cwd(), '../relayd'),
    resolve(process.cwd(), 'apps/relayd'),
    resolve(moduleDir, '../../../../relayd'),
  ]
  for (const candidate of candidates) {
    if (
      existsSyncSafe(join(candidate, 'go.mod'))
      && existsSyncSafe(join(candidate, 'cmd/relayd/main.go'))
    ) {
      return candidate
    }
  }
  return null
}

function existsSyncSafe(path: string): boolean {
  try {
    return existsSync(path)
  }
 catch {
    return false
  }
}

async function spawnRelayd(): Promise<RelaydHandle> {
  if (!relaydSourceDir) {
    throw new Error('relayd source tree not found; cannot run e2e test')
  }
  const port = await allocatePort()
  const listenAddr = `127.0.0.1:${port}`
  const relayUrl = `http://127.0.0.1:${port}`
  const child = spawn('go', ['run', './cmd/relayd'], {
    cwd: relaydSourceDir,
    env: {
      ...process.env,
      CRADLE_RELAYD_LISTEN: listenAddr,
      CRADLE_RELAYD_PUBLIC_URL: relayUrl,
      CRADLE_RELAYD_ROOM_TTL: '30s',
      CRADLE_RELAYD_EXIT_ON_STDIN_CLOSE: '1',
    },
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  const captureOutput = (data: Buffer) => {
    output = `${output}${data.toString()}`.slice(-24_000)
  }
  child.stdout?.on('data', captureOutput)
  let spawnError: Error | undefined
  child.stderr?.on('data', captureOutput)
  child.once('error', (error) => {
    spawnError = error
  })

  try {
    await waitForReady(relayUrl, child, () => output, () => spawnError)
  }
 catch (error) {
    await stopRelayd(child)
    const message = error instanceof Error ? error.message : String(error)
    const details = output.trim()
    throw new Error(
      `relayd failed to start: ${message}${details ? `\n${details}` : ''}`,
      { cause: error },
    )
  }
  return { relayUrl, child, getOutput: () => output }
}

function allocatePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePort(address.port)
      })
    })
  })
}

async function waitForReady(
  relayUrl: string,
  child: ChildProcess,
  getOutput: () => string,
  getSpawnError: () => Error | undefined,
): Promise<void> {
  const deadline = Date.now() + 120_000 // `go run` may download and compile on first launch
  let lastError: unknown
  while (Date.now() < deadline) {
    const childError = getSpawnError()
    if (childError) {
      throw childError
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `relayd exited before readiness${getOutput().trim() ? `: ${getOutput().trim()}` : ''}`,
      )
    }
    try {
      const response = await fetch(new URL('/readyz', `${relayUrl}/`), {
        signal: AbortSignal.timeout(500),
      })
      if (response.ok) {
        return
      }
      lastError = new Error(`relayd ready check returned HTTP ${response.status}`)
    }
 catch (error) {
      lastError = error
    }
    await new Promise(r => setTimeout(r, 200))
  }
  const timeoutMessage = lastError instanceof Error ? lastError.message : 'relayd did not become ready'
  const details = getOutput().trim()
  throw new Error(`${timeoutMessage}${details ? `: ${details}` : ''}`)
}

async function stopRelayd(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  closeRelaydOwnerPipe(child)
  await new Promise<void>((resolveDone) => {
    let resolved = false
    let timeout: ReturnType<typeof setTimeout>
    const resolveOnce = () => {
      if (resolved) {
        return
      }
      resolved = true
      clearTimeout(timeout)
      child.off('exit', resolveOnce)
      resolveDone()
    }
    timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        const signaled = signalRelayd(child, 'SIGKILL')
        if (!signaled) {
          resolveOnce()
        }
      }
    }, 3_000)
    timeout.unref()
    child.once('exit', resolveOnce)
    const signaled = signalRelayd(child, 'SIGTERM')
    if (!signaled) {
      resolveOnce()
    }
  })
}

function signalRelayd(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return true
    }
 catch (error) {
      if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === 'ESRCH'
      ) {
        return false
      }
      throw error
    }
  }
  return child.kill(signal)
}

function closeRelaydOwnerPipe(child: ChildProcess): void {
  const stdin = child.stdin
  if (!stdin || stdin.destroyed) {
    return
  }
  try {
    if (stdin.writable && !stdin.writableEnded) {
      stdin.end()
    }
    stdin.destroy()
  }
 catch {
    // Best-effort cleanup; process signals still handle termination.
  }
}

// ── Host-side bridge: connects /ws/host, runs a RelaySession, and bridges
//    each stream_open to a local TCP target (the fake host server). ──

interface HostBridge {
  session: RelaySession
  stop: () => Promise<void>
}

/**
 * Mirror production host/controller transports: release send credit only after
 * the kernel accepts the local TCP write. Skipping this leaves the peer stuck
 * at the 512 KiB initial stream window (bodies ≥512 KiB hang even at concurrency 1).
 */
function writeHostBridgeStreamData(
  session: RelaySession,
  socket: Socket | undefined,
  streamId: string,
  data: Uint8Array,
): void {
  if (!socket) {
    return
  }
  const chunk = Buffer.from(data)
  socket.write(chunk, (error) => {
    if (error) {
      socket.destroy()
      return
    }
    session.reportStreamDataConsumed(streamId, chunk.byteLength)
  })
}

async function startHostBridge(opts: {
  relayUrl: string
  roomId: string
  hostWsAssertion: SignedRelayAssertion
  hostPrivateKey: string
  hostPublicKey: string
  pairingCode: string
  targetHost: string
  targetPort: number
}): Promise<HostBridge> {
  const streams = new Map<string, Socket>()
  const wsUrl = toWsUrl(opts.relayUrl, '/ws/host')
  const ws = new WebSocket(wsUrl, { headers: relayAssertionHeaders(opts.hostWsAssertion) })

  const session = new RelaySession(
    'host',
    opts.hostPrivateKey,
    { roomId: opts.roomId, ourPublicKeyBase64: opts.hostPublicKey, pairingCode: opts.pairingCode },
    {
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      },
      onStreamOpen: (streamId) => {
        const socket = connect({ host: opts.targetHost, port: opts.targetPort })
        streams.set(streamId, socket)
        socket.on('data', (chunk: Buffer) =>
          session.writeStreamData(streamId, new Uint8Array(chunk)))
        socket.on('close', () => {
          session.closeStream(streamId, 'target closed')
          streams.delete(streamId)
        })
        socket.on('error', () => {
          session.closeStream(streamId, 'target error')
          streams.delete(streamId)
        })
      },
      onStreamData: (streamId, data) => {
        writeHostBridgeStreamData(session, streams.get(streamId), streamId, data)
      },
      onStreamClose: (streamId) => {
        const socket = streams.get(streamId)
        if (socket) {
          socket.destroy()
          streams.delete(streamId)
        }
      },
      onError: () => {},
    },
  )
  ws.on('message', (data: WebSocket.RawData) => {
    session.handleEnvelope(decodeRelayEnvelope(new Uint8Array(data as Buffer)))
  })

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      session.start()
      resolve()
    })
    ws.once('error', reject)
  })

  return {
    session,
    stop: async () => {
      session.close()
      for (const socket of streams.values()) {
        socket.destroy()
      }
      streams.clear()
      ws.removeAllListeners()
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    },
  }
}

interface FabricNodeBridge {
  stop: () => Promise<void>
  getWebSocketState: () => string
}

async function startFabricNodeBridge(opts: {
  relayUrl: string
  fabricId: string
  nodeId: string
  nodeCertificate: Parameters<typeof fabricAuthHeaders>[0]
  identityPrivateKeyBase64: string
  encryptionPrivateKeyBase64: string
  targetHost: string
  targetPort: number
}): Promise<FabricNodeBridge> {
  const sessions = new Map<string, RelaySession>()
  const sockets = new Map<string, Socket>()
  const sessionErrors: string[] = []
  const socketErrors: string[] = []
  const headers = fabricAuthHeaders(opts.nodeCertificate, opts.identityPrivateKeyBase64, 'GET', '/v1/ws/nodes')
  const ws = new WebSocket(toWsUrl(opts.relayUrl, '/v1/ws/nodes'), { headers: Object.fromEntries(headers.entries()) })
  let webSocketError = ''
  let webSocketClose = ''
  ws.on('error', (error) => { webSocketError = error.message })
  ws.on('close', (code, reason) => { webSocketClose = `code=${code} reason=${reason.toString()}` })

  ws.on('message', (data: WebSocket.RawData) => {
    const envelope = decodeFabricEnvelope(relayWebSocketDataView(data))
    if (envelope.fabricId !== opts.fabricId || envelope.nodeId !== opts.nodeId) {
      throw new Error('Fabric node bridge received a route for another Node')
    }
    if (envelope.kind === 'link_open') {
      const controller = JSON.parse(new TextDecoder().decode(envelope.payload)) as Parameters<typeof signFabricCertificate>[1]
      const session = new RelaySession('host', opts.encryptionPrivateKeyBase64, {
        roomId: envelope.linkId,
        ourPublicKeyBase64: opts.nodeCertificate.encryptionPubkey,
        pairingCode: opts.fabricId,
        encodeOutboundEnvelope: frame => encodeFabricEnvelope({ fabricId: opts.fabricId, nodeId: opts.nodeId, linkId: envelope.linkId }, frame),
      }, {
        send: (dataToSend) => { if (ws.readyState === WebSocket.OPEN) { ws.send(dataToSend) } },
        onStreamOpen: (streamId) => {
          const socket = connect({ host: opts.targetHost, port: opts.targetPort })
          sockets.set(streamId, socket)
          socket.on('data', chunk => session.writeStreamData(streamId, new Uint8Array(chunk)))
          socket.on('close', () => { session.closeStream(streamId, 'target closed'); sockets.delete(streamId) })
          socket.on('error', (error) => { socketErrors.push(`stream=${streamId} ${error.message}`); session.closeStream(streamId, 'target error'); sockets.delete(streamId) })
        },
        onStreamData: (streamId, dataToSend) => {
          const socket = sockets.get(streamId)
          if (!socket) { return }
          const chunk = Buffer.from(dataToSend)
          socket.write(chunk, (error) => {
 if (error) { socket.destroy() }
 else { session.reportStreamDataConsumed(streamId, chunk.byteLength) }
})
        },
        onStreamClose: (streamId) => { sockets.get(streamId)?.destroy(); sockets.delete(streamId) },
        onError: (error) => { sessionErrors.push(error.message) },
      })
      if (controller.subjectKind !== 'controller') { throw new Error('Fabric link did not deliver a controller certificate') }
      sessions.set(envelope.linkId, session)
      session.start()
      return
    }
    const session = sessions.get(envelope.linkId)
    if (!session) { throw new Error(`Fabric link ${envelope.linkId} is not open`) }
    session.handleEnvelope(toRelaySessionEnvelope(envelope))
  })

  await new Promise<void>((resolveOpen, rejectOpen) => {
    ws.once('open', () => resolveOpen())
    ws.once('error', rejectOpen)
  })
  return {
    getWebSocketState: () => [...sessionErrors, ...socketErrors, webSocketError, webSocketClose].filter(Boolean).join('; ') || `readyState=${ws.readyState}`,
    stop: async () => {
      for (const session of sessions.values()) { session.close() }
      for (const socket of sockets.values()) { socket.destroy() }
      sessions.clear()
      sockets.clear()
      ws.removeAllListeners()
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) { ws.close() }
    },
  }
}

function toWsUrl(relayUrl: string, path: string): string {
  const url = new URL(path, `${relayUrl.replace(/\/+$/, '')}/`)
  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  }
 else if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  }
  return url.toString()
}

async function callPairingStart(
  relayUrl: string,
  assertion: SignedRelayAssertion,
): Promise<{ pairingCode: string, roomId: string }> {
  const response = await fetch(new URL('/pairing/start', `${relayUrl}/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assertion }),
  })
  if (!response.ok) {
    throw new Error(`/pairing/start returned ${response.status}: ${await response.text()}`)
  }
  return (await response.json()) as { pairingCode: string, roomId: string }
}

async function callPairingClaim(
  relayUrl: string,
  assertion: SignedRelayAssertion,
): Promise<{ roomId: string }> {
  const response = await fetch(new URL('/pairing/claim', `${relayUrl}/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assertion }),
  })
  if (!response.ok) {
    throw new Error(`/pairing/claim returned ${response.status}: ${await response.text()}`)
  }
  return (await response.json()) as { roomId: string }
}

function startFakeHostServer(): Promise<{ baseUrl: string, server: Server, requests: string[] }> {
  const requests: string[] = []
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/hang/')) {
      req.resume()
      return
    }
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      requests.push(`${req.method} ${req.url} ${body}`)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, echo: body, path: req.url }))
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve({ baseUrl: `http://127.0.0.1:${address.port}`, server, requests })
    })
  })
}

describe.skipIf(!relaydSourceDir || !goAvailable)('relay transport e2e (real relayd)', () => {
  let relayd!: RelaydHandle
  let fakeHost!: { baseUrl: string, server: Server, requests: string[] }
  let dataDir!: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-relay-e2e-'))
    process.env.CRADLE_DATA_DIR = dataDir
    relayd = await spawnRelayd()
    fakeHost = await startFakeHostServer()
  }, 180_000)

  afterAll(async () => {
    if (relayd) {
      await stopRelayd(relayd.child)
    }
    if (fakeHost) {
      await new Promise<void>(resolve => fakeHost.server.close(() => resolve()))
    }
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('pairs, tunnels an HTTP request end-to-end, and reconnects with pinned pubkeys', async () => {
    // ── Host: create room + pairing code ──
    const hostKeys = generateRelayKeyPair()
    const controllerKeys = generateRelayKeyPair()
    const hostSigningKeys = generateRelaySigningKeyPair()
    const controllerSigningKeys = generateRelaySigningKeyPair()
    const roomId = createRelayRoomId()
    const hostFingerprint = relayPublicKeyFingerprint(hostKeys.publicKeyBase64)

    const pairingStart = signRelayAssertion(hostSigningKeys.privateKeyBase64, {
      role: 'host',
      purpose: 'create_room',
      roomId,
    })
    const hostWs = signRelayAssertion(hostSigningKeys.privateKeyBase64, {
      role: 'host',
      purpose: 'ws',
      roomId,
    })
    const { pairingCode } = await callPairingStart(relayd.relayUrl, pairingStart)

    // ── Host: start the bridge (WS + session + TCP target = fake host server).
    //    The host session won't be ready until the controller connects and the
    //    handshake completes — that happens in startRelayControllerTransport
    //    below, which retries until both sides are ready. ──
    const fakeHostPort = Number(new URL(fakeHost.baseUrl).port)
    const hostBridge = await startHostBridge({
      relayUrl: relayd.relayUrl,
      roomId,
      hostWsAssertion: hostWs,
      hostPrivateKey: hostKeys.privateKeyBase64,
      hostPublicKey: hostKeys.publicKeyBase64,
      pairingCode,
      targetHost: '127.0.0.1',
      targetPort: fakeHostPort,
    })

    // ── Controller: claim the pairing ──
    const claimAssertion = signRelayAssertion(controllerSigningKeys.privateKeyBase64, {
      role: 'controller',
      purpose: 'claim',
      roomId,
      pairingCode,
    })
    const lookup = await callPairingClaim(relayd.relayUrl, claimAssertion)
    expect(lookup.roomId).toBe(roomId)
    const controllerWs = signRelayAssertion(controllerSigningKeys.privateKeyBase64, {
      role: 'controller',
      purpose: 'ws',
      roomId,
    })

    // ── Controller: start the relay transport (first pairing) ──
    const handle = await startRelayControllerTransport({
      hostId: 'e2e-host',
      relayUrl: relayd.relayUrl,
      roomId,
      wsAssertion: controllerWs,
      controllerPrivateKeyBase64: controllerKeys.privateKeyBase64,
      controllerPublicKeyBase64: controllerKeys.publicKeyBase64,
      pairingCode,
      readyTimeoutMs: 15_000,
    })

    expect(handle.hostPublicKeyBase64).toBe(hostKeys.publicKeyBase64)
    expect(relayPublicKeyFingerprint(handle.hostPublicKeyBase64!)).toBe(hostFingerprint)

    // ── Tunnel an HTTP request through the controller's local port ──
    const response = await fetch(`${handle.localBaseUrl}/hello`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'ping',
    })
    expect(response.status).toBe(200)
    const json = (await response.json()) as { ok: boolean, echo: string, path: string }
    expect(json.ok).toBe(true)
    expect(json.echo).toBe('ping')
    expect(json.path).toBe('/hello')
    expect(fakeHost.requests).toContain('POST /hello ping')

    const coldSnapshot = handle.getPerformanceSnapshot()
    const coldAttempt = coldSnapshot.connectionAttempts.at(-1)
    const coldStream = latestRelayStream(coldSnapshot)
    expect(coldAttempt?.websocketOpenedAt).not.toBeNull()
    expect(coldAttempt?.handshakeReadyAt).not.toBeNull()
    expect(coldSnapshot.localListenerReadyAt).not.toBeNull()
    expect(coldStream?.firstRequestByteAt).not.toBeNull()
    expect(coldStream?.firstResponseByteAt).not.toBeNull()

    // This request reuses the listener/session above: it must not open another
    // WebSocket or perform a second relay handshake before proxying bytes.
    const attemptsBeforeWarmRequest = coldSnapshot.connectionAttempts.length
    const warmResponse = await fetch(`${handle.localBaseUrl}/warm`, { method: 'GET' })
    expect(warmResponse.status).toBe(200)
    await warmResponse.json()
    const warmSnapshot = handle.getPerformanceSnapshot()
    const warmStream = latestRelayStream(warmSnapshot)
    expect(warmSnapshot.connectionAttempts).toHaveLength(attemptsBeforeWarmRequest)
    expect(warmStream?.streamId).not.toBe(coldStream?.streamId)
    expect(warmStream?.firstRequestByteAt).not.toBeNull()
    expect(warmStream?.firstResponseByteAt).not.toBeNull()

    const hangingRequests = Array.from({ length: 32 }, (_, index) => {
      const controller = new AbortController()
      const result = fetch(`${handle.localBaseUrl}/hang/${index}`, {
        signal: controller.signal,
      }).catch(error => error)
      return { controller, result }
    })
    // 64 KiB stays under the initial stream credit without mid-stream acks; 256/512 KiB
    // require host write acknowledgements or the sender wedges at RELAY_STREAM_MIN_CREDIT_BYTES.
    const concurrencyCases = [
      { bodyBytes: 64 * 1024, concurrencies: [1, 8, 64, 128] },
      { bodyBytes: 256 * 1024, concurrencies: [32] },
      { bodyBytes: 512 * 1024, concurrencies: [1, 32] },
    ] as const
    const concurrencyRows = []
    try {
      await new Promise(resolve => setTimeout(resolve, 25))
      for (const { bodyBytes, concurrencies } of concurrencyCases) {
        const concurrentBody = 'x'.repeat(bodyBytes)
        for (const concurrency of concurrencies) {
          const batchStartedAt = performance.now()
          const durations = await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
            const startedAt = performance.now()
            const concurrentResponse = await fetch(
              `${handle.localBaseUrl}/benchmark/${bodyBytes}/${concurrency}/${index}`,
              {
                method: 'POST',
                headers: { 'content-type': 'text/plain' },
                body: concurrentBody,
                signal: AbortSignal.timeout(20_000),
              },
            )
            expect(concurrentResponse.status).toBe(200)
            const body = (await concurrentResponse.json()) as { ok: boolean, echo: string }
            expect(body.ok).toBe(true)
            expect(body.echo).toBe(concurrentBody)
            return performance.now() - startedAt
          }))
          const batchElapsedMs = performance.now() - batchStartedAt
          concurrencyRows.push({
            concurrency,
            requestBodyBytes: bodyBytes,
            p50Ms: percentile(durations, 0.5),
            p95Ms: percentile(durations, 0.95),
            maxMs: Math.max(...durations),
            aggregateUsefulMiBps:
              (concurrency * bodyBytes * 2) / (1024 * 1024) / (batchElapsedMs / 1_000),
          })
        }
      }
      const postLoadProbe = await fetch(`${handle.localBaseUrl}/post-load-probe`, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      })
      expect(postLoadProbe.status).toBe(200)
      await postLoadProbe.json()
    }
    finally {
      for (const request of hangingRequests) {
        request.controller.abort()
      }
      await Promise.all(hangingRequests.map(request => request.result))
    }
    expect(handle.getPerformanceSnapshot().connectionAttempts).toHaveLength(attemptsBeforeWarmRequest)
    console.info([
      '# Relay local-relayd concurrent-stream matrix',
      '',
      'This exercises real loopback WebSocket, relayd scheduler, E2EE session, TCP bridge, and HTTP streams. It is not a WAN, Tailscale, or injected-RTT measurement.',
      '',
      '| Concurrent streams | Request body | p50 complete | p95 complete | max complete | Aggregate useful throughput |',
      '| ---: | ---: | ---: | ---: | ---: | ---: |',
      ...concurrencyRows.map(row =>
        `| ${row.concurrency} | ${row.requestBodyBytes} B | ${row.p50Ms.toFixed(2)} ms | ${row.p95Ms.toFixed(2)} ms | ${row.maxMs.toFixed(2)} ms | ${row.aggregateUsefulMiBps.toFixed(2)} MiB/s |`),
    ].join('\n'))
    console.info(JSON.stringify({
      kind: 'relay-local-e2e-concurrency',
      conditions: {
        relayd: 'local subprocess',
        transport: 'binary-v2',
        hostBridgeAcksAppliedWrites: true,
        connectionAttemptsBeforeMatrix: attemptsBeforeWarmRequest,
        connectionAttemptsAfterMatrix: handle.getPerformanceSnapshot().connectionAttempts.length,
      },
      rows: concurrencyRows,
    }))

    if (coldAttempt && coldSnapshot.localListenerReadyAt !== null && coldStream && warmStream) {
      console.info(JSON.stringify({
        kind: 'relay-cold-warm-checkpoints',
        conditions: { relayd: 'local subprocess', transport: 'binary-v2' },
        cold: {
          connectToWebSocketOpenMs: nonNegativeDuration(coldAttempt.websocketOpenedAt, coldAttempt.startedAt),
          connectToHandshakeReadyMs: nonNegativeDuration(coldAttempt.handshakeReadyAt, coldAttempt.startedAt),
          connectToLocalListenerReadyMs: nonNegativeDuration(coldSnapshot.localListenerReadyAt, coldAttempt.startedAt),
          streamToFirstResponseByteMs: nonNegativeDuration(coldStream.firstResponseByteAt, coldStream.openedAt),
        },
        warm: {
          connectionAttemptsBeforeRequest: attemptsBeforeWarmRequest,
          connectionAttemptsAfterRequest: warmSnapshot.connectionAttempts.length,
          additionalWebSocketOrHandshake: 0,
          streamToFirstResponseByteMs: nonNegativeDuration(warmStream.firstResponseByteAt, warmStream.openedAt),
        },
      }))
    }

    await handle.close()
    await hostBridge.stop()

    // ── Reconnect with pinned pubkeys (no pairing code) ──
    // Re-create the room (host-session) and reconnect both sides.
    const roomStart = signRelayAssertion(hostSigningKeys.privateKeyBase64, {
      role: 'host',
      purpose: 'reconnect',
      roomId,
      controllerPubkey: controllerSigningKeys.publicKeyBase64,
    })
    const hostWs2 = signRelayAssertion(hostSigningKeys.privateKeyBase64, {
      role: 'host',
      purpose: 'ws',
      roomId,
    })
    const renewResponse = await fetch(new URL('/rooms/host-session', `${relayd.relayUrl}/`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assertion: roomStart }),
    })
    expect(renewResponse.ok).toBe(true)

    const hostBridgeReconnect = await startHostBridgePinned({
      relayUrl: relayd.relayUrl,
      roomId,
      hostWsAssertion: hostWs2,
      hostPrivateKey: hostKeys.privateKeyBase64,
      hostPublicKey: hostKeys.publicKeyBase64,
      pinnedControllerPubkey: controllerKeys.publicKeyBase64,
      targetHost: '127.0.0.1',
      targetPort: fakeHostPort,
    })

    const controllerWs2 = signRelayAssertion(controllerSigningKeys.privateKeyBase64, {
      role: 'controller',
      purpose: 'ws',
      roomId,
    })
    const handle2 = await startRelayControllerTransport({
      hostId: 'e2e-host',
      relayUrl: relayd.relayUrl,
      roomId,
      wsAssertion: controllerWs2,
      controllerPrivateKeyBase64: controllerKeys.privateKeyBase64,
      controllerPublicKeyBase64: controllerKeys.publicKeyBase64,
      pinnedHostPubkey: hostKeys.publicKeyBase64,
      readyTimeoutMs: 15_000,
    })

    const response2 = await fetch(`${handle2.localBaseUrl}/again`, { method: 'GET' })
    expect(response2.status).toBe(200)
    const json2 = (await response2.json()) as { ok: boolean, path: string }
    expect(json2.ok).toBe(true)
    expect(json2.path).toBe('/again')

    await handle2.close()
    await hostBridgeReconnect.stop()
  }, 120_000)

  it('enrolls a Node, discovers it, and tunnels through real Fabric relayd', async () => {
    // Keep the Fabric scenario independent from the legacy room scenario. A
    // fresh port also prevents undici from reusing an idle HTTP socket that
    // the previous relayd instance already closed.
    await stopRelayd(relayd.child)
    relayd = await spawnRelayd()

    const owner = generateFabricSigningKeyPair()
    const nodeIdentity = generateFabricSigningKeyPair()
    const nodeEncryption = generateFabricEncryptionKeyPair()
    const controllerIdentity = generateFabricSigningKeyPair()
    const controllerEncryption = generateFabricEncryptionKeyPair()
    const nodeId = 'node-fabric-e2e'
    const controllerId = 'controller-fabric-e2e'

    const fabricResponse = await fetch(new URL('/v1/fabrics', `${relayd.relayUrl}/`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signFabricCreateRequest(owner.privateKeyBase64)),
    })
    expect(fabricResponse.status).toBe(201)
    const fabric = (await fabricResponse.json()) as { fabric: { fabricId: string } }
    const fabricId = fabric.fabric.fabricId

    const deliverySecret = 'fabric-e2e-delivery-secret'
    const joinRequest = signFabricJoinRequest({
      fabricId,
      subjectId: nodeId,
      identityPrivateKeyBase64: nodeIdentity.privateKeyBase64,
      encryptionPubkey: nodeEncryption.publicKeyBase64,
      displayName: 'Fabric E2E Node',
      platform: 'test',
      version: 'e2e',
      capabilities: ['workspace'],
      deliverySecret,
    })
    const joinResponse = await fetch(new URL('/v1/join-requests', `${relayd.relayUrl}/`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(joinRequest),
    })
    expect(joinResponse.status).toBe(201)
    const join = (await joinResponse.json()) as { requestId: string }

    const nodeCertificate = signFabricCertificate(owner.privateKeyBase64, {
      fabricId,
      subjectKind: 'node',
      subjectId: nodeId,
      identityPubkey: nodeIdentity.publicKeyBase64,
      encryptionPubkey: nodeEncryption.publicKeyBase64,
      scopes: ['admin'],
    })
    const approvePath = `/v1/join-requests/${join.requestId}/approve`
    const approveHeaders = ownerProofHeaders(owner.privateKeyBase64, 'POST', approvePath)
    approveHeaders.set('content-type', 'application/json')
    const approveResponse = await fetch(new URL(approvePath, `${relayd.relayUrl}/`), {
      method: 'POST',
      headers: approveHeaders,
      body: JSON.stringify({ certificate: nodeCertificate }),
    })
    expect(approveResponse.status).toBe(200)

    const controllerCertificate = signFabricCertificate(owner.privateKeyBase64, {
      fabricId,
      subjectKind: 'controller',
      subjectId: controllerId,
      identityPubkey: controllerIdentity.publicKeyBase64,
      encryptionPubkey: controllerEncryption.publicKeyBase64,
      scopes: ['control', 'view'],
    })
    const controllerPath = `/v1/fabrics/${fabricId}/controllers`
    const controllerHeaders = ownerProofHeaders(owner.privateKeyBase64, 'POST', controllerPath)
    controllerHeaders.set('content-type', 'application/json')
    const controllerResponse = await fetch(new URL(controllerPath, `${relayd.relayUrl}/`), {
      method: 'POST',
      headers: controllerHeaders,
      body: JSON.stringify({
        certificate: controllerCertificate,
        grants: [{ grantId: 'grant-fabric-e2e', fabricId, controllerId, nodeId, scope: 'control' }],
      }),
    })
    expect(controllerResponse.status).toBe(204)

    const fakeHostPort = Number(new URL(fakeHost.baseUrl).port)
    let nodeBridge: FabricNodeBridge | undefined
    let fabricStage = 'starting node bridge'
    let controllerExit = ''
    try {
      nodeBridge = await startFabricNodeBridge({
        relayUrl: relayd.relayUrl,
        fabricId,
        nodeId,
        nodeCertificate,
        identityPrivateKeyBase64: nodeIdentity.privateKeyBase64,
        encryptionPrivateKeyBase64: nodeEncryption.privateKeyBase64,
        targetHost: '127.0.0.1',
        targetPort: fakeHostPort,
      })

      fabricStage = 'discovering node'
      const listPath = `/v1/fabrics/${fabricId}/nodes`
      let discovered: { nodes: Array<{ nodeId: string, status: string }> } | null = null
      let lastListError = ''
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        try {
          const listHeaders = fabricAuthHeaders(controllerCertificate, controllerIdentity.privateKeyBase64, 'GET', listPath)
          listHeaders.set('connection', 'close')
          const response = await fetch(new URL(listPath, `${relayd.relayUrl}/`), { headers: listHeaders })
          if (response.ok) {
            const candidate = (await response.json()) as { nodes: Array<{ nodeId: string, status: string }> }
            if (candidate.nodes.some(node => node.nodeId === nodeId && node.status === 'online')) {
              discovered = candidate
              break
            }
          }
        }
        catch (error) {
          lastListError = error instanceof Error ? error.message : String(error)
        }
        await new Promise(resolveWait => setTimeout(resolveWait, 100))
      }
      if (!discovered && lastListError) {
        throw new Error(`Fabric Node discovery did not become ready: ${lastListError}`)
      }
      expect(discovered?.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ nodeId, status: 'online' })]))

      fabricStage = 'opening node link'
      const openPath = `/v1/nodes/${nodeId}/links`
      const openHeaders = fabricAuthHeaders(controllerCertificate, controllerIdentity.privateKeyBase64, 'POST', openPath)
      openHeaders.set('connection', 'close')
      const openResponse = await fetch(new URL(openPath, `${relayd.relayUrl}/`), { method: 'POST', headers: openHeaders })
      expect(openResponse.status).toBe(201)
      const link = (await openResponse.json()) as { linkId: string, nodeCertificate: typeof nodeCertificate }

      fabricStage = 'starting controller transport'
      const transport = await startRelayControllerTransport({
        hostId: nodeId,
        relayUrl: relayd.relayUrl,
        roomId: link.linkId,
        controllerPrivateKeyBase64: controllerEncryption.privateKeyBase64,
        controllerPublicKeyBase64: controllerEncryption.publicKeyBase64,
        pinnedHostPubkey: link.nodeCertificate.encryptionPubkey,
        fabric: { fabricId, nodeId, linkId: link.linkId, headers: fabricAuthHeaders(controllerCertificate, controllerIdentity.privateKeyBase64, 'GET', `/v1/ws/controllers/${link.linkId}`) },
      })
      transport.onExit((exit) => { controllerExit = `code=${exit.code} signal=${exit.signal}` })
      try {
        fabricStage = 'round-tripping tunneled HTTP'
        const response = await fetch(`${transport.localBaseUrl}/fabric-e2e`, { method: 'GET' })
        expect(response.status).toBe(200)
        expect(((await response.json()) as { ok: boolean, path: string }).path).toBe('/fabric-e2e')
      }
      finally {
        await transport.close()
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const relaydState = relayd.child.exitCode === null
        ? 'relayd is still running'
        : `relayd exited with code ${relayd.child.exitCode}`
      throw new Error(`${message}; stage=${fabricStage}; ${relaydState}; node websocket ${nodeBridge?.getWebSocketState() ?? 'not connected'}; controller ${controllerExit || 'still connected'}\n${relayd.getOutput().trim()}`, { cause: error })
    }
    finally {
      await nodeBridge?.stop()
    }
  }, 60_000)
})

function latestRelayStream(snapshot: RelayControllerPerformanceSnapshot): RelayStreamCheckpoint | undefined {
  return [...snapshot.activeStreams, ...snapshot.completedStreams]
    .sort((left, right) => right.openedAt - left.openedAt)[0]
}

function nonNegativeDuration(end: number | null, start: number): number | null {
  return end === null ? null : Math.max(0, end - start)
}

function percentile(samples: number[], percentileValue: number): number {
  const ordered = [...samples].sort((left, right) => left - right)
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * percentileValue) - 1)
  return ordered[index]!
}

// Pinned-pubkey variant of startHostBridge for the reconnect phase.
async function startHostBridgePinned(opts: {
  relayUrl: string
  roomId: string
  hostWsAssertion: SignedRelayAssertion
  hostPrivateKey: string
  hostPublicKey: string
  pinnedControllerPubkey: string
  targetHost: string
  targetPort: number
}): Promise<HostBridge> {
  const streams = new Map<string, Socket>()
  const wsUrl = toWsUrl(opts.relayUrl, '/ws/host')
  const ws = new WebSocket(wsUrl, { headers: relayAssertionHeaders(opts.hostWsAssertion) })

  const session = new RelaySession(
    'host',
    opts.hostPrivateKey,
    {
      roomId: opts.roomId,
      ourPublicKeyBase64: opts.hostPublicKey,
      pinnedPeerPubkey: opts.pinnedControllerPubkey,
    },
    {
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      },
      onStreamOpen: (streamId) => {
        const socket = connect({ host: opts.targetHost, port: opts.targetPort })
        streams.set(streamId, socket)
        socket.on('data', (chunk: Buffer) =>
          session.writeStreamData(streamId, new Uint8Array(chunk)))
        socket.on('close', () => {
          session.closeStream(streamId, 'target closed')
          streams.delete(streamId)
        })
        socket.on('error', () => {
          session.closeStream(streamId, 'target error')
          streams.delete(streamId)
        })
      },
      onStreamData: (streamId, data) => {
        writeHostBridgeStreamData(session, streams.get(streamId), streamId, data)
      },
      onStreamClose: (streamId) => {
        const socket = streams.get(streamId)
        if (socket) {
          socket.destroy()
          streams.delete(streamId)
        }
      },
      onError: () => {},
    },
  )
  ws.on('message', (data: WebSocket.RawData) => {
    session.handleEnvelope(decodeRelayEnvelope(new Uint8Array(data as Buffer)))
  })

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      session.start()
      resolve()
    })
    ws.once('error', reject)
  })

  return {
    session,
    stop: async () => {
      session.close()
      for (const socket of streams.values()) {
        socket.destroy()
      }
      streams.clear()
      ws.removeAllListeners()
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    },
  }
}
