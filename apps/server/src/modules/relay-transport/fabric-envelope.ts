import { AppError } from '../../errors/app-error'
import type { RelayEnvelope, RelayEnvelopeKind, RelayPriority } from './protocol'
import { RELAY_PROTOCOL_VERSION } from './protocol'
import type { RelayOutboundEnvelope } from './session'

export const FABRIC_ENVELOPE_VERSION = 3
const HEADER_BYTES = 24

export interface FabricEnvelopeRoute { fabricId: string, nodeId: string, linkId: string }
export interface DecodedFabricEnvelope extends FabricEnvelopeRoute { streamId?: string, seq: number, ack: number, kind: 'link_open' | 'link_ready' | RelayEnvelopeKind, priority: RelayPriority, payload: Uint8Array }

const kindToCode = { link_open: 1, link_ready: 2, relay_data_frame: 3, relay_peer_closed: 4, relay_error: 5 } as const
const codeToKind = new Map<number, DecodedFabricEnvelope['kind']>(Object.entries(kindToCode).map(([kind, code]) => [code, kind as DecodedFabricEnvelope['kind']]))

export function encodeFabricEnvelope(route: FabricEnvelopeRoute, frame: RelayOutboundEnvelope): Uint8Array {
  const fields = [utf8(route.fabricId, 'Fabric id'), utf8(route.nodeId, 'Node id'), utf8(route.linkId, 'Link id'), frame.streamId ? utf8(frame.streamId, 'Stream id') : new Uint8Array()]
  const kind = kindToCode[frame.kind]
  if (!kind || frame.payload.byteLength === 0) { throw protocolError('Invalid Fabric relay envelope.') }
  const out = new Uint8Array(HEADER_BYTES + fields.reduce((total, field) => total + field.byteLength, 0) + frame.payload.byteLength)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  out[0] = FABRIC_ENVELOPE_VERSION; out[1] = kind; out[2] = frame.priority === 'control' ? 1 : 2
  view.setUint16(4, fields[0].byteLength); view.setUint16(6, fields[1].byteLength); view.setUint16(8, fields[2].byteLength); view.setUint16(10, fields[3].byteLength)
  view.setUint32(12, frame.seq); view.setUint32(16, 0); view.setUint32(20, frame.payload.byteLength)
  let offset = HEADER_BYTES
  for (const field of fields) { out.set(field, offset); offset += field.byteLength }
  out.set(frame.payload, offset)
  return out
}

export function decodeFabricEnvelope(bytes: Uint8Array): DecodedFabricEnvelope {
  if (bytes.byteLength < HEADER_BYTES || bytes[0] !== FABRIC_ENVELOPE_VERSION) { throw protocolError('Unsupported Fabric relay envelope.') }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const kind = codeToKind.get(bytes[1]); const priority = bytes[2] === 1 ? 'control' : bytes[2] === 2 ? 'data' : null
  const lengths = [view.getUint16(4), view.getUint16(6), view.getUint16(8), view.getUint16(10)]
  const payloadLength = view.getUint32(20)
  const expected = HEADER_BYTES + lengths.reduce((total, length) => total + length, 0) + payloadLength
  if (!kind || !priority || !lengths[0] || !lengths[1] || !lengths[2] || !payloadLength || expected !== bytes.byteLength) { throw protocolError('Invalid Fabric relay envelope.') }
  let offset = HEADER_BYTES
  const [fabricId, nodeId, linkId, streamId] = lengths.map((length, index) => { const result = length ? decode(bytes.subarray(offset, offset + length), ['fabric id', 'node id', 'link id', 'stream id'][index]!) : undefined; offset += length; return result })
  return { fabricId: fabricId!, nodeId: nodeId!, linkId: linkId!, ...(streamId ? { streamId } : {}), seq: view.getUint32(12), ack: view.getUint32(16), kind, priority, payload: bytes.subarray(offset) }
}

/**
 * Converts a real v3 envelope into the logical envelope consumed by the
 * existing encrypted session state machine. Routing has already been checked
 * by FabricNodeLinkManager, so it is deliberately not retained here.
 */
export function toRelaySessionEnvelope(envelope: DecodedFabricEnvelope): RelayEnvelope {
  if (envelope.kind === 'link_open' || envelope.kind === 'link_ready') { throw protocolError('Fabric link control is not an encrypted session frame.') }
  return { version: RELAY_PROTOCOL_VERSION, roomId: envelope.linkId, seq: envelope.seq, kind: envelope.kind, priority: envelope.priority, ...(envelope.streamId ? { streamId: envelope.streamId } : {}), payload: envelope.payload }
}

function utf8(value: string, label: string): Uint8Array { const bytes = new TextEncoder().encode(value); if (!bytes.byteLength || bytes.byteLength > 0xFFFF) { throw protocolError(`${label} is invalid.`) } return bytes }
function decode(value: Uint8Array, label: string): string {
 try { return new TextDecoder('utf-8', { fatal: true }).decode(value) }
 catch { throw protocolError(`${label} is invalid.`) }
}
function protocolError(message: string): AppError { return new AppError({ code: 'fabric_protocol_invalid_frame', status: 400, message }) }
