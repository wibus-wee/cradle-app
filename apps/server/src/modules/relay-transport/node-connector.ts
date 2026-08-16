import { randomBytes } from 'node:crypto'
import net from 'node:net'

import WebSocket from 'ws'

import { AppError } from '../../errors/app-error'
import { CRADLE_RELAY_TOKEN_HEADER } from '../../http/auth'
import type { MembershipCertificate } from '../fabric/protocol'
import { assertFabricCertificate, fabricAuthHeaders } from '../fabric/protocol'
import { getFabricMembership, requireFabricMembershipSecretRefs } from '../fabric/service'
import { readSecret, upsertSecret } from '../secrets/service'
import { decodeFabricEnvelope, encodeFabricEnvelope, toRelaySessionEnvelope } from './fabric-envelope'
import { RelaySession } from './session'
import { relayWebSocketDataView } from './websocket-data'

interface ActiveStream { socket: net.Socket, writer: FabricHttpRequestWriter }

/**
 * One authenticated WebSocket per local Node. Each Fabric link has its own
 * encrypted RelaySession and stream map, so a slow or revoked Controller can
 * never share byte accounting with another Controller.
 */
export class FabricNodeConnector {
  private ws: WebSocket | null = null
  private stopped = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private readonly sessions = new Map<string, RelaySession>()
  private readonly streams = new Map<string, Map<string, ActiveStream>>()

  constructor(private readonly localServerHost: string, private readonly localServerPort: number) {}

  start(): void { this.stopped = false; if (getFabricMembership()?.role !== 'pending-node') { void readFabricNodeAuthToken() } void this.connect() }
  stop(): void { this.stopped = true; if (this.reconnectTimer) { clearTimeout(this.reconnectTimer) } this.reconnectTimer = null; this.ws?.close(); this.ws = null; this.sessions.clear(); for (const streams of this.streams.values()) { for (const stream of streams.values()) { stream.socket.destroy() } } this.streams.clear() }

  private async connect(): Promise<void> {
    if (this.stopped) { return }
    const membership = getFabricMembership()
    if (!membership || membership.role === 'pending-node') { return }
    const secretRefs = requireFabricMembershipSecretRefs()
    const headers = fabricAuthHeaders(membership.nodeCertificate, readSecret(secretRefs.identityKeySecretId), 'GET', '/v1/ws/nodes')
    const url = new URL('/v1/ws/nodes', `${membership.relayUrl}/`); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(url, { headers: Object.fromEntries(headers.entries()) })
    this.ws = ws
    ws.on('message', (data) => {
      try { this.handleEnvelope(relayWebSocketDataView(data), membership.nodeCertificate, readSecret(secretRefs.encryptionKeySecretId), membership.fabricId) }
      catch { ws.close(1008, 'Invalid Fabric frame') }
    })
    const reconnect = () => { if (!this.stopped && this.ws === ws) { this.ws = null; this.reconnectTimer = setTimeout(() => void this.connect(), 1_000); this.reconnectTimer.unref?.() } }
    ws.once('close', reconnect); ws.once('error', reconnect)
  }

  private handleEnvelope(bytes: Uint8Array, nodeCertificate: MembershipCertificate, encryptionPrivateKey: string, fabricId: string): void {
    const envelope = decodeFabricEnvelope(bytes)
    if (envelope.fabricId !== fabricId || envelope.nodeId !== nodeCertificate.subjectId) { throw new AppError({ code: 'fabric_protocol_route_mismatch', status: 400, message: 'Fabric relay route mismatch.' }) }
    if (envelope.kind === 'link_open') { this.openLink(envelope.linkId, envelope.payload, nodeCertificate, encryptionPrivateKey, fabricId); return }
    const session = this.sessions.get(envelope.linkId)
    if (!session) { throw new AppError({ code: 'fabric_link_not_open', status: 400, message: 'Fabric link has not been authorized by this Node.' }) }
    session.handleEnvelope(toRelaySessionEnvelope(envelope))
  }

  private openLink(linkId: string, payload: Uint8Array, nodeCertificate: MembershipCertificate, encryptionPrivateKey: string, fabricId: string): void {
    if (this.sessions.has(linkId)) { return }
    const controller = JSON.parse(new TextDecoder().decode(payload)) as MembershipCertificate
    assertFabricCertificate(controller, nodeCertificate.issuerPubkey, fabricId)
    if (controller.subjectKind !== 'controller' || (controller.nodeId !== undefined && controller.nodeId !== nodeCertificate.subjectId) || !controller.scopes.some(scope => scope === 'control' || scope === 'admin')) { throw new AppError({ code: 'fabric_controller_unauthorized', status: 403, message: 'Controller certificate cannot control this Node.' }) }
    const streams = new Map<string, ActiveStream>(); this.streams.set(linkId, streams)
    const session = new RelaySession('host', encryptionPrivateKey, {
      roomId: linkId,
ourPublicKeyBase64: nodeCertificate.encryptionPubkey,
pairingCode: fabricId,
      encodeOutboundEnvelope: frame => encodeFabricEnvelope({ fabricId, nodeId: nodeCertificate.subjectId, linkId }, frame),
    }, {
      send: (data) => { if (this.ws?.readyState === WebSocket.OPEN) { this.ws.send(data) } },
      onStreamOpen: streamId => this.openStream(linkId, streamId, session),
      onStreamData: (streamId, data) => { const stream = streams.get(streamId); stream?.writer.write(data, consumed => session.reportStreamDataConsumed(streamId, consumed)) },
      onStreamClose: (streamId) => { streams.get(streamId)?.socket.destroy(); streams.delete(streamId) },
      onPeerClosed: () => this.closeLink(linkId),
onError: () => this.closeLink(linkId),
      onPauseStream: streamId => streams.get(streamId)?.socket.pause(),
onResumeStream: streamId => streams.get(streamId)?.socket.resume(),
    })
    this.sessions.set(linkId, session); session.start()
  }

  private openStream(linkId: string, streamId: string, session: RelaySession): void {
    const socket = net.connect({ host: this.localServerHost, port: this.localServerPort })
    const streams = this.streams.get(linkId)!; streams.set(streamId, { socket, writer: new FabricHttpRequestWriter(socket, readFabricNodeAuthToken(), () => session.closeStream(streamId, 'invalid relay request')) })
    socket.on('data', chunk => session.writeStreamData(streamId, new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)))
    socket.on('close', () => { session.closeStream(streamId, 'local server socket closed'); streams.delete(streamId) })
    socket.on('error', () => { session.closeStream(streamId, 'local server socket error'); streams.delete(streamId) })
  }

  private closeLink(linkId: string): void { this.sessions.get(linkId)?.close(); this.sessions.delete(linkId); for (const stream of this.streams.get(linkId)?.values() ?? []) { stream.socket.destroy() } this.streams.delete(linkId) }
}

function readFabricNodeAuthToken(): string {
  const membership = getFabricMembership(); if (!membership) { throw new Error('Fabric membership is unavailable') }
  const id = `fabric-node-auth:${membership.fabricId}:${membership.localNodeId}`
  try { return readSecret(id) }
 catch { const token = randomBytes(32).toString('base64url'); upsertSecret({ id, kind: 'system-fabric-node-auth-token', label: 'Cradle Fabric Node tunnel token', secret: token }); return token }
}

export function listActiveFabricNodeAuthTokens(): string[] {
  try { return [readFabricNodeAuthToken()] }
 catch { return [] }
}

class FabricHttpRequestWriter {
  private buffered: Buffer[] = []; private length = 0; private released = false; private pendingBytes = 0
  constructor(private readonly socket: net.Socket, private readonly token: string, private readonly reject: () => void) {}
  write(data: Uint8Array, consumed: (bytes: number) => void): void {
    const chunk = Buffer.from(data); if (this.released) { return this.writeSocket(chunk, data.byteLength, consumed) }
    this.buffered.push(chunk); this.length += chunk.byteLength; this.pendingBytes += chunk.byteLength
    if (this.length > 64 * 1024) { return this.reject() }
    const all = Buffer.concat(this.buffered, this.length); const end = all.indexOf('\r\n\r\n'); if (end < 0) { return }
    const head = rewriteHead(all.subarray(0, end).toString('latin1'), this.token); if (!head) { return this.reject() }
    this.released = true; const original = this.pendingBytes; this.buffered = []; this.length = 0; this.pendingBytes = 0
    this.writeSocket(Buffer.concat([Buffer.from(`${head}\r\n\r\n`, 'latin1'), all.subarray(end + 4)]), original, consumed)
  }

  private writeSocket(data: Buffer, original: number, consumed: (bytes: number) => void): void {
 this.socket.write(data, (error) => {
 if (error) { this.socket.destroy() }
 else { consumed(original) }
})
}
}

function rewriteHead(header: string, token: string): string | null {
  const lines = header.split('\r\n'); if (!lines[0] || !/^[A-Z!#$%&'*+.^_`|~-]+ \S+ HTTP\/1\.[01]$/.test(lines[0])) { return null }
  const hasUpgrade = lines.slice(1).some(line => line.toLowerCase().startsWith('upgrade:') || line.toLowerCase().includes('connection: upgrade'))
  return [lines[0], ...lines.slice(1).filter(line => !line.toLowerCase().startsWith(`${CRADLE_RELAY_TOKEN_HEADER}:`) && !line.toLowerCase().startsWith('connection:')), `${CRADLE_RELAY_TOKEN_HEADER}: ${token}`, ...(hasUpgrade ? [] : ['Connection: close'])].join('\r\n')
}
