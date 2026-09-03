import { invalidFabricFrame } from './error'
import type { FabricSessionEnvelope, FabricSessionEnvelopeKind, RelayPriority } from './session-codec'
import {
  FABRIC_SESSION_PROTOCOL_VERSION,
} from './session-codec'

export const FABRIC_ENVELOPE_VERSION = 3
const HEADER_BYTES = 24

export interface FabricEnvelopeRoute { fabricId: string, nodeId: string, linkId: string }
export interface FabricOutboundEnvelope { seq: number, kind: FabricSessionEnvelopeKind, priority: RelayPriority, streamId?: string, payload: Uint8Array }
export interface DecodedFabricEnvelope extends FabricEnvelopeRoute { streamId?: string, seq: number, ack: number, kind: 'link_open' | 'link_ready' | FabricSessionEnvelopeKind, priority: RelayPriority, payload: Uint8Array }

const kindToCode = { link_open: 1, link_ready: 2, relay_data_frame: 3, relay_peer_closed: 4, relay_error: 5 } as const
const codeToKind = new Map<number, DecodedFabricEnvelope['kind']>(Object.entries(kindToCode).map(([kind, code]) => [code, kind as DecodedFabricEnvelope['kind']]))

export function encodeFabricEnvelope(route: FabricEnvelopeRoute, frame: FabricOutboundEnvelope): Uint8Array {
  const fields = [utf8(route.fabricId, 'Fabric id'), utf8(route.nodeId, 'Node id'), utf8(route.linkId, 'Link id'), frame.streamId ? utf8(frame.streamId, 'Stream id') : new Uint8Array()]
  const kind = kindToCode[frame.kind]
  if (!kind || frame.payload.byteLength === 0) { throw invalidFabricFrame('Invalid Fabric relay envelope.') }
  const out = new Uint8Array(HEADER_BYTES + fields.reduce((total, field) => total + field.byteLength, 0) + frame.payload.byteLength)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  out[0] = FABRIC_ENVELOPE_VERSION
  out[1] = kind
  out[2] = frame.priority === 'control' ? 1 : 2
  view.setUint16(4, fields[0]!.byteLength)
  view.setUint16(6, fields[1]!.byteLength)
  view.setUint16(8, fields[2]!.byteLength)
  view.setUint16(10, fields[3]!.byteLength)
  view.setUint32(12, frame.seq)
  view.setUint32(16, 0)
  view.setUint32(20, frame.payload.byteLength)
  let offset = HEADER_BYTES
  for (const field of fields) {
    out.set(field, offset)
    offset += field.byteLength
  }
  out.set(frame.payload, offset)
  return out
}

export function decodeFabricEnvelope(bytes: Uint8Array): DecodedFabricEnvelope {
  if (bytes.byteLength < HEADER_BYTES || bytes[0] !== FABRIC_ENVELOPE_VERSION) { throw invalidFabricFrame('Unsupported Fabric relay envelope.') }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const kind = codeToKind.get(bytes[1]!)
  const priority = bytes[2] === 1 ? 'control' : bytes[2] === 2 ? 'data' : null
  const lengths = [view.getUint16(4), view.getUint16(6), view.getUint16(8), view.getUint16(10)]
  const payloadLength = view.getUint32(20)
  const expected = HEADER_BYTES + lengths.reduce((total, length) => total + length, 0) + payloadLength
  if (!kind || !priority || !lengths[0] || !lengths[1] || !lengths[2] || !payloadLength || expected !== bytes.byteLength) { throw invalidFabricFrame('Invalid Fabric relay envelope.') }
  let offset = HEADER_BYTES
  const values = lengths.map((length, index) => {
    const result = length ? decode(bytes.subarray(offset, offset + length), ['fabric id', 'node id', 'link id', 'stream id'][index]!) : undefined
    offset += length
    return result
  })
  return {
    fabricId: values[0]!,
    nodeId: values[1]!,
    linkId: values[2]!,
    ...(values[3] ? { streamId: values[3] } : {}),
    seq: view.getUint32(12),
    ack: view.getUint32(16),
    kind,
    priority,
    payload: bytes.subarray(offset),
  }
}

export function toFabricSessionEnvelope(envelope: DecodedFabricEnvelope): FabricSessionEnvelope {
  if (envelope.kind === 'link_open' || envelope.kind === 'link_ready') { throw invalidFabricFrame('Fabric link control is not an encrypted session frame.') }
  return {
    version: FABRIC_SESSION_PROTOCOL_VERSION,
    linkId: envelope.linkId,
    seq: envelope.seq,
    kind: envelope.kind,
    priority: envelope.priority,
    ...(envelope.streamId ? { streamId: envelope.streamId } : {}),
    payload: envelope.payload,
  }
}

function utf8(value: string, label: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  if (!bytes.byteLength || bytes.byteLength > 0xFFFF) { throw invalidFabricFrame(`${label} is invalid.`) }
  return bytes
}

function decode(value: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  }
  catch {
    throw invalidFabricFrame(`${label} is invalid.`)
  }
}
