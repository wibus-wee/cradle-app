import { base64ToBytes, bytesToBase64 } from './bytes'
import { FabricProtocolError } from './error'

export const FABRIC_SESSION_PROTOCOL_VERSION = 2
export const RELAY_MAX_FRAME_BYTES = 1 << 20
export const RELAY_MAX_STREAM_CHUNK_BYTES = 64 * 1024
export const RELAY_STREAM_MIN_CREDIT_BYTES = 512 * 1024
export const RELAY_STREAM_MAX_CREDIT_BYTES = 8 * 1024 * 1024
export const RELAY_CONNECTION_MAX_CREDIT_BYTES = 16 * 1024 * 1024

export const FABRIC_CIPHER_SUITE = {
  aes256Gcm: 'aes-256-gcm',
  xchacha20Poly1305: 'xchacha20poly1305',
} as const
export type FabricCipherSuite = (typeof FABRIC_CIPHER_SUITE)[keyof typeof FABRIC_CIPHER_SUITE]

export const RELAY_COMPRESSION_KIND = { none: 'none', zstd: 'zstd' } as const
export type RelayCompressionKind = (typeof RELAY_COMPRESSION_KIND)[keyof typeof RELAY_COMPRESSION_KIND]

export const FABRIC_SESSION_ENVELOPE_KIND = {
  dataFrame: 'relay_data_frame',
  peerClosed: 'relay_peer_closed',
  relayError: 'relay_error',
} as const
export type FabricSessionEnvelopeKind = (typeof FABRIC_SESSION_ENVELOPE_KIND)[keyof typeof FABRIC_SESSION_ENVELOPE_KIND]
export type RelayPriority = 'control' | 'data'

export interface FabricSessionEnvelope {
  version: typeof FABRIC_SESSION_PROTOCOL_VERSION
  linkId: string
  seq: number
  kind: FabricSessionEnvelopeKind
  priority: RelayPriority
  streamId?: string
  payload: Uint8Array
}

export interface RelayPeerClosedPayload { role?: string, reason?: string }
export interface RelayErrorPayload { error?: string }

export const INNER_FRAME_KIND = {
  hello: 'hello',
  streamOpen: 'stream_open',
  streamData: 'stream_data',
  streamAck: 'stream_ack',
  streamClose: 'stream_close',
} as const

export type InnerFrame
  = | { kind: 'hello', version: number, pubkey: string, selection: boolean, cipherSuites: FabricCipherSuite[], compressions: RelayCompressionKind[] }
    | { kind: 'stream_open', streamId: string }
    | { kind: 'stream_data', streamId: string, seq: number, data: Uint8Array, compression?: RelayCompressionKind, uncompressedBytes?: number }
    | { kind: 'stream_ack', streamId: string, ackedBytes: number }
    | { kind: 'stream_close', streamId: string, reason?: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf8', { fatal: true })
const SESSION_ENVELOPE_HEADER_BYTES = 16
const FLAG_HAS_STREAM_ID = 1
const COMPRESSED_STREAM_DATA_CODE = 7
const HELLO_SELECTION_FLAG = 1

const cipherSuiteBits: Record<FabricCipherSuite, number> = {
  [FABRIC_CIPHER_SUITE.aes256Gcm]: 1,
  [FABRIC_CIPHER_SUITE.xchacha20Poly1305]: 2,
}
const compressionBits: Record<RelayCompressionKind, number> = { zstd: 1, none: 2 }
const envelopeKindCode: Record<FabricSessionEnvelopeKind, number> = {
  [FABRIC_SESSION_ENVELOPE_KIND.dataFrame]: 1,
  [FABRIC_SESSION_ENVELOPE_KIND.peerClosed]: 2,
  [FABRIC_SESSION_ENVELOPE_KIND.relayError]: 3,
}
const envelopeKindFromCode: Record<number, FabricSessionEnvelopeKind | undefined> = {
  1: FABRIC_SESSION_ENVELOPE_KIND.dataFrame,
  2: FABRIC_SESSION_ENVELOPE_KIND.peerClosed,
  3: FABRIC_SESSION_ENVELOPE_KIND.relayError,
}
const innerFrameCode: Record<InnerFrame['kind'], number> = {
  [INNER_FRAME_KIND.hello]: 1,
  [INNER_FRAME_KIND.streamOpen]: 2,
  [INNER_FRAME_KIND.streamData]: 3,
  [INNER_FRAME_KIND.streamAck]: 4,
  [INNER_FRAME_KIND.streamClose]: 5,
}

export function encodeFabricSessionEnvelope(envelope: FabricSessionEnvelope): Uint8Array {
  if (envelope.version !== FABRIC_SESSION_PROTOCOL_VERSION) { throw protocolError(`Unsupported relay protocol version ${envelope.version}.`) }
  checkedUint32(envelope.seq, 'Relay sequence')
  const linkId = bytesForString(envelope.linkId, 'Fabric link id')
  const streamId = envelope.streamId ? bytesForString(envelope.streamId, 'Stream id') : new Uint8Array()
  const kind = envelopeKindCode[envelope.kind]
  if (!kind || (envelope.priority !== 'control' && envelope.priority !== 'data') || envelope.payload.length === 0) { throw protocolError('Invalid relay envelope.') }
  const out = new Uint8Array(SESSION_ENVELOPE_HEADER_BYTES + linkId.length + streamId.length + envelope.payload.length)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  out[0] = FABRIC_SESSION_PROTOCOL_VERSION
  out[1] = kind
  out[2] = envelope.priority === 'control' ? 1 : 2
  out[3] = streamId.length > 0 ? FLAG_HAS_STREAM_ID : 0
  view.setUint16(4, linkId.length)
  view.setUint16(6, streamId.length)
  view.setUint32(8, envelope.seq)
  view.setUint32(12, envelope.payload.length)
  out.set(linkId, SESSION_ENVELOPE_HEADER_BYTES)
  out.set(streamId, SESSION_ENVELOPE_HEADER_BYTES + linkId.length)
  out.set(envelope.payload, SESSION_ENVELOPE_HEADER_BYTES + linkId.length + streamId.length)
  return out
}

export function decodeFabricSessionEnvelope(bytes: Uint8Array, maxFrameBytes = RELAY_MAX_FRAME_BYTES): FabricSessionEnvelope {
  if (bytes.length > maxFrameBytes) { throw new FabricProtocolError('relay_protocol_frame_too_large', 'Relay frame exceeds the configured maximum.') }
  if (bytes.length < SESSION_ENVELOPE_HEADER_BYTES) { throw protocolError('Relay envelope is too short.') }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes[0] !== FABRIC_SESSION_PROTOCOL_VERSION) { throw protocolError(`Unsupported relay protocol version ${bytes[0]}.`) }
  const kind = envelopeKindFromCode[bytes[1]!]
  const priority = bytes[2] === 1 ? 'control' : bytes[2] === 2 ? 'data' : undefined
  const flags = bytes[3]!
  const linkLength = view.getUint16(4)
  const streamLength = view.getUint16(6)
  const payloadLength = view.getUint32(12)
  const expectedLength = SESSION_ENVELOPE_HEADER_BYTES + linkLength + streamLength + payloadLength
  if (!kind || !priority || (flags & ~FLAG_HAS_STREAM_ID) !== 0 || expectedLength !== bytes.length || linkLength === 0 || payloadLength === 0) { throw protocolError('Invalid relay envelope fields.') }
  if (Boolean(flags & FLAG_HAS_STREAM_ID) !== (streamLength > 0)) { throw protocolError('Relay envelope stream-id flag does not match its length.') }
  const linkId = readString(bytes, SESSION_ENVELOPE_HEADER_BYTES, linkLength, 'Fabric link id')
  const streamOffset = SESSION_ENVELOPE_HEADER_BYTES + linkLength
  const streamId = streamLength > 0 ? readString(bytes, streamOffset, streamLength, 'stream id') : undefined
  return {
    version: FABRIC_SESSION_PROTOCOL_VERSION,
    linkId,
    seq: view.getUint32(8),
    kind,
    priority,
    ...(streamId ? { streamId } : {}),
    payload: bytes.subarray(streamOffset + streamLength),
  }
}

export function encodeRelayControlPayload(value: RelayPeerClosedPayload | RelayErrorPayload): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

export function decodeRelayPeerClosedPayload(bytes: Uint8Array): RelayPeerClosedPayload {
  return decodeControlPayload(bytes, 'peer closed')
}

export function decodeRelayErrorPayload(bytes: Uint8Array): RelayErrorPayload {
  return decodeControlPayload(bytes, 'relay error')
}

export function encodeInnerFrame(frame: InnerFrame): Uint8Array {
  switch (frame.kind) {
    case INNER_FRAME_KIND.hello: {
      const pubkey = base64ToBytes(frame.pubkey)
      if (pubkey.length !== 32) { throw protocolError('Hello public keys must be 32 bytes.') }
      const out = new Uint8Array(40)
      out[0] = innerFrameCode[frame.kind]
      out[1] = frame.version
      out[2] = frame.selection ? HELLO_SELECTION_FLAG : 0
      out[3] = capabilityMask(frame.cipherSuites, cipherSuiteBits, 'cipher suite')
      out[4] = capabilityMask(frame.compressions, compressionBits, 'compression')
      out.set(pubkey, 8)
      return out
    }
    case INNER_FRAME_KIND.streamOpen:
      return encodeStreamStringFrame(innerFrameCode[frame.kind], frame.streamId)
    case INNER_FRAME_KIND.streamClose:
      return encodeStreamStringFrame(innerFrameCode[frame.kind], frame.streamId, frame.reason)
    case INNER_FRAME_KIND.streamData:
      return encodeStreamDataFrame(frame)
    case INNER_FRAME_KIND.streamAck: {
      checkedUint32(frame.ackedBytes, 'Acknowledged byte count')
      const streamId = bytesForString(frame.streamId, 'Stream id')
      const out = new Uint8Array(7 + streamId.length)
      const view = new DataView(out.buffer)
      out[0] = innerFrameCode[frame.kind]
      view.setUint16(1, streamId.length)
      view.setUint32(3, frame.ackedBytes)
      out.set(streamId, 7)
      return out
    }
  }
}

export function decodeInnerFrame(bytes: Uint8Array): InnerFrame {
  if (bytes.length < 1) { throw protocolError('Inner frame is empty.') }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  switch (bytes[0]) {
    case 1:
      return decodeHelloFrame(bytes, view)
    case 2:
      return decodeStreamStringFrame(bytes, view, INNER_FRAME_KIND.streamOpen)
    case 3:
    case COMPRESSED_STREAM_DATA_CODE:
      return decodeStreamDataFrame(bytes, view)
    case 4: {
      if (bytes.length < 7) { throw protocolError('Stream-ack frame is too short.') }
      const streamLength = view.getUint16(1)
      if (streamLength === 0 || 7 + streamLength !== bytes.length) { throw protocolError('Invalid stream-ack length.') }
      return { kind: INNER_FRAME_KIND.streamAck, streamId: readString(bytes, 7, streamLength, 'stream id'), ackedBytes: view.getUint32(3) }
    }
    case 5:
      return decodeStreamStringFrame(bytes, view, INNER_FRAME_KIND.streamClose)
    default:
      throw protocolError(`Unknown inner frame code ${bytes[0]}.`)
  }
}

export function relayPriorityForInnerFrame(frame: InnerFrame): RelayPriority {
  return frame.kind === INNER_FRAME_KIND.streamData || frame.kind === INNER_FRAME_KIND.streamClose ? 'data' : 'control'
}

function encodeStreamDataFrame(frame: Extract<InnerFrame, { kind: 'stream_data' }>): Uint8Array {
  checkedUint32(frame.seq, 'Stream sequence')
  const streamId = bytesForString(frame.streamId, 'Stream id')
  const compressed = frame.compression === 'zstd'
  if (frame.compression && frame.compression !== 'none' && !compressed) { throw protocolError('Unknown stream-data compression.') }
  const dataLength = frame.data.byteLength
  const uncompressedBytes = frame.uncompressedBytes ?? dataLength
  if (dataLength === 0 || dataLength > RELAY_MAX_STREAM_CHUNK_BYTES || !Number.isSafeInteger(uncompressedBytes) || uncompressedBytes <= 0 || uncompressedBytes > RELAY_MAX_STREAM_CHUNK_BYTES || (!compressed && uncompressedBytes !== dataLength) || (compressed && dataLength >= uncompressedBytes)) { throw protocolError('Invalid stream-data length.') }
  const headerBytes = compressed ? 11 : 7
  const out = new Uint8Array(headerBytes + streamId.length + dataLength)
  const view = new DataView(out.buffer)
  out[0] = compressed ? COMPRESSED_STREAM_DATA_CODE : innerFrameCode[frame.kind]
  view.setUint16(1, streamId.length)
  view.setUint32(3, frame.seq)
  if (compressed) { view.setUint32(7, uncompressedBytes) }
  out.set(streamId, headerBytes)
  out.set(frame.data, headerBytes + streamId.length)
  return out
}

function decodeStreamDataFrame(bytes: Uint8Array, view: DataView): InnerFrame {
  const compressed = bytes[0] === COMPRESSED_STREAM_DATA_CODE
  const headerBytes = compressed ? 11 : 7
  if (bytes.length < headerBytes) { throw protocolError('Stream-data frame is too short.') }
  const streamLength = view.getUint16(1)
  const uncompressedBytes = compressed ? view.getUint32(7) : undefined
  if (streamLength === 0 || headerBytes + streamLength >= bytes.length || (!compressed && bytes.length - headerBytes - streamLength > RELAY_MAX_STREAM_CHUNK_BYTES) || (compressed && (!uncompressedBytes || uncompressedBytes > RELAY_MAX_STREAM_CHUNK_BYTES))) { throw protocolError('Invalid stream-data length.') }
  const data = bytes.subarray(headerBytes + streamLength)
  if (data.length > RELAY_MAX_STREAM_CHUNK_BYTES || (compressed && data.length >= uncompressedBytes!)) { throw protocolError('Invalid compressed stream-data length.') }
  return {
    kind: INNER_FRAME_KIND.streamData,
    streamId: readString(bytes, headerBytes, streamLength, 'stream id'),
    seq: view.getUint32(3),
    data,
    ...(compressed ? { compression: 'zstd' as const, uncompressedBytes } : {}),
  }
}

function decodeHelloFrame(bytes: Uint8Array, view: DataView): InnerFrame {
  if (bytes.length < 40) { throw protocolError('Hello frame is too short.') }
  const flags = bytes[2]!
  if ((flags & ~HELLO_SELECTION_FLAG) !== 0 || bytes[5] !== 0 || view.getUint16(6) !== 0 || bytes.length !== 40) { throw protocolError('Invalid hello fields.') }
  const cipherSuites = capabilitiesFromMask(bytes[3]!, cipherSuiteBits, 'cipher suite')
  const compressions = capabilitiesFromMask(bytes[4]!, compressionBits, 'compression')
  const selection = (flags & HELLO_SELECTION_FLAG) !== 0
  if (selection && (cipherSuites.length !== 1 || compressions.length !== 1)) { throw protocolError('Hello selection must choose exactly one cipher suite and compression mode.') }
  return { kind: INNER_FRAME_KIND.hello, version: bytes[1]!, pubkey: bytesToBase64(bytes.slice(8, 40)), selection, cipherSuites, compressions }
}

function encodeStreamStringFrame(kind: number, streamIdValue: string, reason?: string): Uint8Array {
  const streamId = bytesForString(streamIdValue, 'Stream id')
  const reasonBytes = reason ? bytesForString(reason, 'Close reason') : new Uint8Array()
  const out = new Uint8Array(5 + streamId.length + reasonBytes.length)
  const view = new DataView(out.buffer)
  out[0] = kind
  view.setUint16(1, streamId.length)
  view.setUint16(3, reasonBytes.length)
  out.set(streamId, 5)
  out.set(reasonBytes, 5 + streamId.length)
  return out
}

function decodeStreamStringFrame(bytes: Uint8Array, view: DataView, kind: 'stream_open' | 'stream_close'): InnerFrame {
  if (bytes.length < 5) { throw protocolError(`${kind} frame is too short.`) }
  const streamLength = view.getUint16(1)
  const reasonLength = view.getUint16(3)
  if (streamLength === 0 || 5 + streamLength + reasonLength !== bytes.length || (kind === INNER_FRAME_KIND.streamOpen && reasonLength !== 0)) { throw protocolError(`Invalid ${kind} lengths.`) }
  const streamId = readString(bytes, 5, streamLength, 'stream id')
  if (kind === INNER_FRAME_KIND.streamOpen) { return { kind, streamId } }
  const reason = reasonLength ? readString(bytes, 5 + streamLength, reasonLength, 'close reason') : undefined
  return { kind, streamId, ...(reason ? { reason } : {}) }
}

function decodeControlPayload(bytes: Uint8Array, label: string): { role?: string, reason?: string, error?: string } {
  try {
    const value: { role?: string, reason?: string, error?: string } = JSON.parse(decoder.decode(bytes))
    if (typeof value !== 'object' || value === null) { throw new Error('not an object') }
    return value
  }
  catch {
    throw protocolError(`Invalid ${label} control payload.`)
  }
}

function checkedUint32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xFFFF_FFFF) { throw protocolError(`${label} must be an unsigned 32-bit integer.`) }
}

function bytesForString(value: string, label: string): Uint8Array {
  const bytes = encoder.encode(value)
  if (bytes.length === 0 || bytes.length > 0xFFFF) { throw protocolError(`${label} must contain between 1 and 65535 UTF-8 bytes.`) }
  return bytes
}

function readString(bytes: Uint8Array, start: number, length: number, label: string): string {
  if (length <= 0 || start < 0 || start + length > bytes.length) { throw protocolError(`Invalid ${label} length.`) }
  try {
    return decoder.decode(bytes.subarray(start, start + length))
  }
  catch {
    throw protocolError(`Invalid UTF-8 ${label}.`)
  }
}

function capabilityMask<T extends string>(values: T[], bits: Record<T, number>, label: string): number {
  const unique = new Set(values)
  if (unique.size === 0 || unique.size !== values.length) { throw protocolError(`Hello ${label} capabilities must be non-empty and unique.`) }
  let mask = 0
  for (const value of unique) {
    const bit = bits[value]
    if (!bit) { throw protocolError(`Unknown hello ${label} capability.`) }
    mask |= bit
  }
  return mask
}

function capabilitiesFromMask<T extends string>(mask: number, bits: Record<T, number>, label: string): T[] {
  const knownMask = (Object.values(bits) as number[]).reduce((result, bit) => result | bit, 0)
  if (mask === 0 || (mask & ~knownMask) !== 0) { throw protocolError(`Invalid hello ${label} capability mask.`) }
  return (Object.entries(bits) as Array<[T, number]>).filter(([, bit]) => (mask & bit) !== 0).map(([value]) => value)
}

function protocolError(message: string): FabricProtocolError {
  return new FabricProtocolError('relay_protocol_invalid_frame', message)
}
