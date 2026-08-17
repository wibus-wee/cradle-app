import { AppError } from '../../errors/app-error'
import type { RelayCompressionKind } from './compression'

/**
 * Fabric Session protocol. The Fabric v3 envelope owns routing and relayd
 * scheduling; this envelope only carries one encrypted session payload.
 */
export const FABRIC_SESSION_PROTOCOL_VERSION = 1

export const RELAY_MAX_FRAME_BYTES = 1 << 20 // 1 MiB
export const RELAY_MAX_STREAM_CHUNK_BYTES = 64 * 1024 // 64 KiB
export const RELAY_STREAM_MIN_CREDIT_BYTES = 512 * 1024
export const RELAY_STREAM_MAX_CREDIT_BYTES = 8 * 1024 * 1024
export const RELAY_CONNECTION_MAX_CREDIT_BYTES = 16 * 1024 * 1024

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

export interface RelayPeerClosedPayload {
  role?: string
  reason?: string
}

export interface RelayErrorPayload {
  error?: string
}

export const INNER_FRAME_KIND = {
  hello: 'hello',
  streamOpen: 'stream_open',
  streamData: 'stream_data',
  streamAck: 'stream_ack',
  streamClose: 'stream_close',
} as const

export type InnerFrame
  = | {
      kind: 'hello'
      version: number
      pubkey: string
    }
    | { kind: 'stream_open', streamId: string }
    | {
      kind: 'stream_data'
      streamId: string
      seq: number
      data: Uint8Array
      compression?: RelayCompressionKind
      uncompressedBytes?: number
    }
    | { kind: 'stream_ack', streamId: string, ackedBytes: number }
    | { kind: 'stream_close', streamId: string, reason?: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf8', { fatal: true })
const OUTER_HEADER_BYTES = 16
const FLAG_HAS_STREAM_ID = 1
const COMPRESSED_STREAM_DATA_CODE = 7

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

function protocolError(message: string): AppError {
  return new AppError({ code: 'relay_protocol_invalid_frame', status: 400, message })
}

function checkedUint32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xFFFF_FFFF) {
    throw protocolError(`${label} must be an unsigned 32-bit integer.`)
  }
}

function bytesForString(value: string, label: string, maxBytes = 0xFFFF): Uint8Array {
  const bytes = encoder.encode(value)
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw protocolError(`${label} must contain between 1 and ${maxBytes} UTF-8 bytes.`)
  }
  return bytes
}

function optionalString(value: string | undefined, label: string, maxBytes = 0xFFFF): Uint8Array {
  if (!value) {
    return new Uint8Array()
  }
  return bytesForString(value, label, maxBytes)
}

function readString(bytes: Uint8Array, start: number, length: number, label: string): string {
  if (length <= 0 || start < 0 || start + length > bytes.length) {
    throw protocolError(`Invalid ${label} length.`)
  }
  try {
    return decoder.decode(bytes.subarray(start, start + length))
  }
 catch {
    throw protocolError(`Invalid UTF-8 ${label}.`)
  }
}

function base64ToBytes(value: string, label: string): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(value, 'base64'))
  if (bytes.length === 0) {
    throw protocolError(`Invalid ${label}.`)
  }
  return bytes
}

export function encodeFabricSessionEnvelope(envelope: FabricSessionEnvelope): Uint8Array {
  if (envelope.version !== FABRIC_SESSION_PROTOCOL_VERSION) {
    throw protocolError(`Unsupported relay protocol version ${envelope.version}.`)
  }
  checkedUint32(envelope.seq, 'Relay sequence')
  const linkId = bytesForString(envelope.linkId, 'Fabric link id')
  const streamId = envelope.streamId
    ? bytesForString(envelope.streamId, 'Stream id')
    : new Uint8Array()
  const kind = envelopeKindCode[envelope.kind]
  if (
    !kind
    || (envelope.priority !== 'control' && envelope.priority !== 'data')
    || envelope.payload.length === 0
  ) {
    throw protocolError('Invalid relay envelope.')
  }
  if (linkId.length > 0xFFFF || streamId.length > 0xFFFF || envelope.payload.length > 0xFFFF_FFFF) {
    throw protocolError('Relay envelope exceeds binary field bounds.')
  }
  const out = new Uint8Array(
    OUTER_HEADER_BYTES + linkId.length + streamId.length + envelope.payload.length,
  )
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  out[0] = FABRIC_SESSION_PROTOCOL_VERSION
  out[1] = kind
  out[2] = envelope.priority === 'control' ? 1 : 2
  out[3] = streamId.length > 0 ? FLAG_HAS_STREAM_ID : 0
  view.setUint16(4, linkId.length)
  view.setUint16(6, streamId.length)
  view.setUint32(8, envelope.seq)
  view.setUint32(12, envelope.payload.length)
  out.set(linkId, OUTER_HEADER_BYTES)
  out.set(streamId, OUTER_HEADER_BYTES + linkId.length)
  out.set(envelope.payload, OUTER_HEADER_BYTES + linkId.length + streamId.length)
  return out
}

export function decodeFabricSessionEnvelope(
  bytes: Uint8Array,
  maxFrameBytes = RELAY_MAX_FRAME_BYTES,
): FabricSessionEnvelope {
  if (bytes.length > maxFrameBytes) {
    throw new AppError({
      code: 'relay_protocol_frame_too_large',
      status: 400,
      message: 'Relay frame exceeds the configured maximum.',
    })
  }
  if (bytes.length < OUTER_HEADER_BYTES) {
    throw protocolError('Relay envelope is too short.')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes[0] !== FABRIC_SESSION_PROTOCOL_VERSION) {
    throw protocolError(`Unsupported relay protocol version ${bytes[0]}.`)
  }
  const kind = envelopeKindFromCode[bytes[1]]
  const priority = bytes[2] === 1 ? 'control' : bytes[2] === 2 ? 'data' : undefined
  const flags = bytes[3]
  const linkLength = view.getUint16(4)
  const streamLength = view.getUint16(6)
  const seq = view.getUint32(8)
  const payloadLength = view.getUint32(12)
  const expectedLength = OUTER_HEADER_BYTES + linkLength + streamLength + payloadLength
  if (
    !kind
    || !priority
    || (flags & ~FLAG_HAS_STREAM_ID) !== 0
    || expectedLength !== bytes.length
    || linkLength === 0
    || payloadLength === 0
  ) {
    throw protocolError('Invalid relay envelope fields.')
  }
  if (Boolean(flags & FLAG_HAS_STREAM_ID) !== (streamLength > 0)) {
    throw protocolError('Relay envelope stream-id flag does not match its length.')
  }
  const linkId = readString(bytes, OUTER_HEADER_BYTES, linkLength, 'Fabric link id')
  const streamOffset = OUTER_HEADER_BYTES + linkLength
  const streamId
    = streamLength > 0 ? readString(bytes, streamOffset, streamLength, 'stream id') : undefined
  const payload = bytes.subarray(streamOffset + streamLength)
  return {
    version: FABRIC_SESSION_PROTOCOL_VERSION,
    linkId,
    seq,
    kind,
    priority,
    ...(streamId ? { streamId } : {}),
    payload,
  }
}

export function encodeRelayControlPayload(
  value: RelayPeerClosedPayload | RelayErrorPayload,
): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

export function decodeRelayPeerClosedPayload(bytes: Uint8Array): RelayPeerClosedPayload {
  return decodeControlPayload(bytes, 'peer closed')
}

export function decodeRelayErrorPayload(bytes: Uint8Array): RelayErrorPayload {
  return decodeControlPayload(bytes, 'relay error')
}

function decodeControlPayload(
  bytes: Uint8Array,
  label: string,
): { role?: string, reason?: string, error?: string } {
  try {
    const value: { role?: string, reason?: string, error?: string } = JSON.parse(
      decoder.decode(bytes),
    )
    if (typeof value !== 'object' || value === null) {
      throw new Error('not an object')
    }
    return value
  }
 catch {
    throw protocolError(`Invalid ${label} control payload.`)
  }
}

export function encodeInnerFrame(frame: InnerFrame): Uint8Array {
  switch (frame.kind) {
    case INNER_FRAME_KIND.hello: {
      const pubkey = base64ToBytes(frame.pubkey, 'hello public key')
      if (pubkey.length !== 32) {
        throw protocolError('Hello public keys must be 32 bytes.')
      }
      const out = new Uint8Array(8 + pubkey.length)
      const view = new DataView(out.buffer)
      out[0] = innerFrameCode[frame.kind]
      out[1] = frame.version
      out[2] = 0
      out[3] = 0
      view.setUint16(4, 0)
      view.setUint16(6, 0)
      out.set(pubkey, 8)
      return out
    }
    case INNER_FRAME_KIND.streamOpen:
      return encodeStreamStringFrame(innerFrameCode[frame.kind], frame.streamId)
    case INNER_FRAME_KIND.streamClose:
      return encodeStreamStringFrame(innerFrameCode[frame.kind], frame.streamId, frame.reason)
    case INNER_FRAME_KIND.streamData: {
      checkedUint32(frame.seq, 'Stream sequence')
      const streamId = bytesForString(frame.streamId, 'Stream id')
      const isCompressed = frame.compression === 'zstd'
      if (frame.compression && frame.compression !== 'none' && !isCompressed) {
        throw protocolError('Unknown stream-data compression.')
      }
      const dataLength = frame.data.byteLength
      const uncompressedBytes = frame.uncompressedBytes ?? dataLength
      if (
        dataLength === 0
        || dataLength > RELAY_MAX_STREAM_CHUNK_BYTES
        || !Number.isSafeInteger(uncompressedBytes)
        || uncompressedBytes <= 0
        || uncompressedBytes > RELAY_MAX_STREAM_CHUNK_BYTES
        || (!isCompressed && uncompressedBytes !== dataLength)
        || (isCompressed && dataLength >= uncompressedBytes)
      ) {
        throw protocolError('Invalid stream-data length.')
      }
      const headerBytes = isCompressed ? 11 : 7
      const out = new Uint8Array(headerBytes + streamId.length + dataLength)
      const view = new DataView(out.buffer)
      out[0] = isCompressed ? COMPRESSED_STREAM_DATA_CODE : innerFrameCode[frame.kind]
      view.setUint16(1, streamId.length)
      view.setUint32(3, frame.seq)
      if (isCompressed) {
        view.setUint32(7, uncompressedBytes)
      }
      const dataOffset = headerBytes + streamId.length
      out.set(streamId, headerBytes)
      out.set(frame.data, dataOffset)
      return out
    }
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

function encodeStreamStringFrame(kind: number, streamIdValue: string, reason?: string): Uint8Array {
  const streamId = bytesForString(streamIdValue, 'Stream id')
  const reasonBytes = reason ? optionalString(reason, 'Close reason') : new Uint8Array()
  const out = new Uint8Array(5 + streamId.length + reasonBytes.length)
  const view = new DataView(out.buffer)
  out[0] = kind
  view.setUint16(1, streamId.length)
  view.setUint16(3, reasonBytes.length)
  out.set(streamId, 5)
  out.set(reasonBytes, 5 + streamId.length)
  return out
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
    case COMPRESSED_STREAM_DATA_CODE: {
      const compressed = bytes[0] === COMPRESSED_STREAM_DATA_CODE
      const headerBytes = compressed ? 11 : 7
      if (bytes.length < headerBytes) { throw protocolError('Stream-data frame is too short.') }
      const streamLength = view.getUint16(1)
      const seq = view.getUint32(3)
      const uncompressedBytes = compressed ? view.getUint32(7) : undefined
      if (
        streamLength === 0
        || headerBytes + streamLength >= bytes.length
        || (!compressed && bytes.length - headerBytes - streamLength > RELAY_MAX_STREAM_CHUNK_BYTES)
        || (compressed && (!uncompressedBytes || uncompressedBytes > RELAY_MAX_STREAM_CHUNK_BYTES))
      ) { throw protocolError('Invalid stream-data length.') }
      const data = bytes.subarray(headerBytes + streamLength)
      if (data.length > RELAY_MAX_STREAM_CHUNK_BYTES || (compressed && data.length >= uncompressedBytes!)) {
        throw protocolError('Invalid compressed stream-data length.')
      }
      return {
        kind: INNER_FRAME_KIND.streamData,
        streamId: readString(bytes, headerBytes, streamLength, 'stream id'),
        seq,
        data,
        ...(compressed ? { compression: 'zstd' as const, uncompressedBytes } : {}),
      }
    }
    case 4: {
      if (bytes.length < 7) { throw protocolError('Stream-ack frame is too short.') }
      const streamLength = view.getUint16(1)
      if (streamLength === 0 || 7 + streamLength !== bytes.length) { throw protocolError('Invalid stream-ack length.') }
      return {
        kind: INNER_FRAME_KIND.streamAck,
        streamId: readString(bytes, 7, streamLength, 'stream id'),
        ackedBytes: view.getUint32(3),
      }
    }
    case 5:
      return decodeStreamStringFrame(bytes, view, INNER_FRAME_KIND.streamClose)
    default:
      throw protocolError(`Unknown inner frame code ${bytes[0]}.`)
  }
}

function decodeHelloFrame(bytes: Uint8Array, view: DataView): InnerFrame {
  if (bytes.length < 40) { throw protocolError('Hello frame is too short.') }
  const flags = bytes[2]
  const nameLength = view.getUint16(4)
  const signingLength = view.getUint16(6)
  if (flags !== 0 || nameLength !== 0 || signingLength !== 0 || bytes.length !== 40) { throw protocolError('Invalid hello fields.') }
  const offset = 8
  const pubkey = bytes.slice(offset, offset + 32)
  return {
    kind: INNER_FRAME_KIND.hello,
    version: bytes[1],
    pubkey: Buffer.from(pubkey).toString('base64'),
  }
}

function decodeStreamStringFrame(
  bytes: Uint8Array,
  view: DataView,
  kind: 'stream_open' | 'stream_close',
): InnerFrame {
  if (bytes.length < 5) { throw protocolError(`${kind} frame is too short.`) }
  const streamLength = view.getUint16(1)
  const reasonLength = view.getUint16(3)
  if (
    streamLength === 0
    || 5 + streamLength + reasonLength !== bytes.length
    || (kind === INNER_FRAME_KIND.streamOpen && reasonLength !== 0)
  ) {
    throw protocolError(`Invalid ${kind} lengths.`)
  }
  const streamId = readString(bytes, 5, streamLength, 'stream id')
  if (kind === INNER_FRAME_KIND.streamOpen) { return { kind, streamId } }
  const reason = reasonLength
    ? readString(bytes, 5 + streamLength, reasonLength, 'close reason')
    : undefined
  return { kind, streamId, ...(reason ? { reason } : {}) }
}

export function relayPriorityForInnerFrame(frame: InnerFrame): RelayPriority {
  return frame.kind === INNER_FRAME_KIND.streamData ? 'data' : 'control'
}

/** Benchmark-only reference size; Fabric never accepts or emits this format. */
export function referenceJsonWireBytesForStreamData(data: Uint8Array): number {
  const referenceInner = JSON.stringify({
    kind: 'stream_data',
    streamId: 'benchmark',
    seq: 0,
    data: Buffer.from(data).toString('base64'),
  })
  // The reference serialized nonce(24) || ciphertext || tag(16) as base64.
  // The nonce and tag values are irrelevant to the exact wire length, so use
  // zero bytes here instead of performing random encryption.
  const referenceCiphertext = Buffer.concat([
    Buffer.alloc(24),
    Buffer.from(referenceInner),
    Buffer.alloc(16),
  ]).toString('base64')
  return Buffer.byteLength(
    JSON.stringify({
      version: 1,
      linkId: 'fabric-benchmark-link',
      seq: 0,
      kind: 'relay_data_frame',
      payload: { ciphertext: referenceCiphertext },
    }),
  )
}
