import { AppError } from '../../errors/app-error'

/**
 * Relay transport protocol. relayd validates and schedules only this outer
 * envelope. All inner frames after the initial key exchange are encrypted end
 * to end, and data bytes never pass through JSON or Base64.
 */
export const RELAY_PROTOCOL_VERSION = 2

export const RELAY_MAX_FRAME_BYTES = 1 << 20 // 1 MiB
export const RELAY_MAX_STREAM_CHUNK_BYTES = 64 * 1024 // 64 KiB
export const RELAY_STREAM_MIN_CREDIT_BYTES = 512 * 1024
export const RELAY_STREAM_MAX_CREDIT_BYTES = 8 * 1024 * 1024
export const RELAY_CONNECTION_MAX_CREDIT_BYTES = 16 * 1024 * 1024

export const RELAY_ENVELOPE_KIND = {
  dataFrame: 'relay_data_frame',
  peerClosed: 'relay_peer_closed',
  relayError: 'relay_error',
} as const

export type RelayEnvelopeKind = (typeof RELAY_ENVELOPE_KIND)[keyof typeof RELAY_ENVELOPE_KIND]
export type RelayPriority = 'control' | 'data'

export interface RelayEnvelope {
  version: typeof RELAY_PROTOCOL_VERSION
  roomId: string
  seq: number
  kind: RelayEnvelopeKind
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
  helloConfirm: 'hello_confirm',
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
      pinnedPubkey?: string
      name?: string
      signingPubkey?: string
    }
    | { kind: 'hello_confirm', confirm: string }
    | { kind: 'stream_open', streamId: string }
    | { kind: 'stream_data', streamId: string, seq: number, data: Uint8Array }
    | { kind: 'stream_ack', streamId: string, ackedBytes: number }
    | { kind: 'stream_close', streamId: string, reason?: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf8', { fatal: true })
const OUTER_HEADER_BYTES = 16
const FLAG_HAS_STREAM_ID = 1

const envelopeKindCode: Record<RelayEnvelopeKind, number> = {
  [RELAY_ENVELOPE_KIND.dataFrame]: 1,
  [RELAY_ENVELOPE_KIND.peerClosed]: 2,
  [RELAY_ENVELOPE_KIND.relayError]: 3,
}

const envelopeKindFromCode: Record<number, RelayEnvelopeKind | undefined> = {
  1: RELAY_ENVELOPE_KIND.dataFrame,
  2: RELAY_ENVELOPE_KIND.peerClosed,
  3: RELAY_ENVELOPE_KIND.relayError,
}

const innerFrameCode: Record<InnerFrame['kind'], number> = {
  [INNER_FRAME_KIND.hello]: 1,
  [INNER_FRAME_KIND.helloConfirm]: 2,
  [INNER_FRAME_KIND.streamOpen]: 3,
  [INNER_FRAME_KIND.streamData]: 4,
  [INNER_FRAME_KIND.streamAck]: 5,
  [INNER_FRAME_KIND.streamClose]: 6,
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

export function encodeRelayEnvelope(envelope: RelayEnvelope): Uint8Array {
  if (envelope.version !== RELAY_PROTOCOL_VERSION) {
    throw protocolError(`Unsupported relay protocol version ${envelope.version}.`)
  }
  checkedUint32(envelope.seq, 'Relay sequence')
  const roomId = bytesForString(envelope.roomId, 'Room id')
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
  if (roomId.length > 0xFFFF || streamId.length > 0xFFFF || envelope.payload.length > 0xFFFF_FFFF) {
    throw protocolError('Relay envelope exceeds binary field bounds.')
  }
  const out = new Uint8Array(
    OUTER_HEADER_BYTES + roomId.length + streamId.length + envelope.payload.length,
  )
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  out[0] = RELAY_PROTOCOL_VERSION
  out[1] = kind
  out[2] = envelope.priority === 'control' ? 1 : 2
  out[3] = streamId.length > 0 ? FLAG_HAS_STREAM_ID : 0
  view.setUint16(4, roomId.length)
  view.setUint16(6, streamId.length)
  view.setUint32(8, envelope.seq)
  view.setUint32(12, envelope.payload.length)
  out.set(roomId, OUTER_HEADER_BYTES)
  out.set(streamId, OUTER_HEADER_BYTES + roomId.length)
  out.set(envelope.payload, OUTER_HEADER_BYTES + roomId.length + streamId.length)
  return out
}

export function decodeRelayEnvelope(
  bytes: Uint8Array,
  maxFrameBytes = RELAY_MAX_FRAME_BYTES,
): RelayEnvelope {
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
  if (bytes[0] !== RELAY_PROTOCOL_VERSION) {
    throw protocolError(`Unsupported relay protocol version ${bytes[0]}.`)
  }
  const kind = envelopeKindFromCode[bytes[1]]
  const priority = bytes[2] === 1 ? 'control' : bytes[2] === 2 ? 'data' : undefined
  const flags = bytes[3]
  const roomLength = view.getUint16(4)
  const streamLength = view.getUint16(6)
  const seq = view.getUint32(8)
  const payloadLength = view.getUint32(12)
  const expectedLength = OUTER_HEADER_BYTES + roomLength + streamLength + payloadLength
  if (
    !kind
    || !priority
    || (flags & ~FLAG_HAS_STREAM_ID) !== 0
    || expectedLength !== bytes.length
    || roomLength === 0
    || payloadLength === 0
  ) {
    throw protocolError('Invalid relay envelope fields.')
  }
  if (Boolean(flags & FLAG_HAS_STREAM_ID) !== (streamLength > 0)) {
    throw protocolError('Relay envelope stream-id flag does not match its length.')
  }
  const roomId = readString(bytes, OUTER_HEADER_BYTES, roomLength, 'room id')
  const streamOffset = OUTER_HEADER_BYTES + roomLength
  const streamId
    = streamLength > 0 ? readString(bytes, streamOffset, streamLength, 'stream id') : undefined
  const payload = bytes.slice(streamOffset + streamLength)
  return {
    version: RELAY_PROTOCOL_VERSION,
    roomId,
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
      const pinned = frame.pinnedPubkey
        ? base64ToBytes(frame.pinnedPubkey, 'pinned public key')
        : new Uint8Array()
      if (pubkey.length !== 32 || (pinned.length > 0 && pinned.length !== 32)) {
        throw protocolError('Hello public keys must be 32 bytes.')
      }
      const name = optionalString(frame.name, 'Peer name', 128)
      const signing = optionalString(frame.signingPubkey, 'Signing public key', 128)
      const out = new Uint8Array(8 + pubkey.length + pinned.length + name.length + signing.length)
      const view = new DataView(out.buffer)
      out[0] = innerFrameCode[frame.kind]
      out[1] = frame.version
      out[2] = (pinned.length ? 1 : 0) | (name.length ? 2 : 0) | (signing.length ? 4 : 0)
      out[3] = 0
      view.setUint16(4, name.length)
      view.setUint16(6, signing.length)
      let offset = 8
      out.set(pubkey, offset)
      offset += pubkey.length
      if (pinned.length) {
        out.set(pinned, offset)
        offset += pinned.length
      }
      out.set(name, offset)
      offset += name.length
      out.set(signing, offset)
      return out
    }
    case INNER_FRAME_KIND.helloConfirm: {
      const confirm = base64ToBytes(frame.confirm, 'hello confirmation')
      if (confirm.length > 0xFFFF) { throw protocolError('Hello confirmation is too large.') }
      const out = new Uint8Array(3 + confirm.length)
      out[0] = innerFrameCode[frame.kind]
      new DataView(out.buffer).setUint16(1, confirm.length)
      out.set(confirm, 3)
      return out
    }
    case INNER_FRAME_KIND.streamOpen:
      return encodeStreamStringFrame(innerFrameCode[frame.kind], frame.streamId)
    case INNER_FRAME_KIND.streamClose:
      return encodeStreamStringFrame(innerFrameCode[frame.kind], frame.streamId, frame.reason)
    case INNER_FRAME_KIND.streamData: {
      checkedUint32(frame.seq, 'Stream sequence')
      const streamId = bytesForString(frame.streamId, 'Stream id')
      if (frame.data.length === 0 || frame.data.length > RELAY_MAX_STREAM_CHUNK_BYTES) { throw protocolError('Invalid stream-data length.') }
      const out = new Uint8Array(7 + streamId.length + frame.data.length)
      const view = new DataView(out.buffer)
      out[0] = innerFrameCode[frame.kind]
      view.setUint16(1, streamId.length)
      view.setUint32(3, frame.seq)
      out.set(streamId, 7)
      out.set(frame.data, 7 + streamId.length)
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
    case 2: {
      if (bytes.length < 3) { throw protocolError('Hello confirmation is too short.') }
      const length = view.getUint16(1)
      if (length === 0 || length + 3 !== bytes.length) { throw protocolError('Invalid hello confirmation length.') }
      return {
        kind: INNER_FRAME_KIND.helloConfirm,
        confirm: Buffer.from(bytes.subarray(3)).toString('base64'),
      }
    }
    case 3:
      return decodeStreamStringFrame(bytes, view, INNER_FRAME_KIND.streamOpen)
    case 4: {
      if (bytes.length < 7) { throw protocolError('Stream-data frame is too short.') }
      const streamLength = view.getUint16(1)
      const seq = view.getUint32(3)
      if (streamLength === 0 || 7 + streamLength >= bytes.length) { throw protocolError('Invalid stream-data length.') }
      return {
        kind: INNER_FRAME_KIND.streamData,
        streamId: readString(bytes, 7, streamLength, 'stream id'),
        seq,
        data: bytes.slice(7 + streamLength),
      }
    }
    case 5: {
      if (bytes.length < 7) { throw protocolError('Stream-ack frame is too short.') }
      const streamLength = view.getUint16(1)
      if (streamLength === 0 || 7 + streamLength !== bytes.length) { throw protocolError('Invalid stream-ack length.') }
      return {
        kind: INNER_FRAME_KIND.streamAck,
        streamId: readString(bytes, 7, streamLength, 'stream id'),
        ackedBytes: view.getUint32(3),
      }
    }
    case 6:
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
  if ((flags & ~7) !== 0) { throw protocolError('Invalid hello flags.') }
  let offset = 8
  const pubkey = bytes.slice(offset, offset + 32)
  offset += 32
  let pinnedPubkey: string | undefined
  if (flags & 1) {
    if (offset + 32 > bytes.length) { throw protocolError('Hello pinned key is truncated.') }
    pinnedPubkey = Buffer.from(bytes.subarray(offset, offset + 32)).toString('base64')
    offset += 32
  }
  if (
    offset + nameLength + signingLength !== bytes.length
    || Boolean(flags & 2) !== (nameLength > 0)
    || Boolean(flags & 4) !== (signingLength > 0)
  ) {
    throw protocolError('Invalid hello field lengths.')
  }
  const name = nameLength ? readString(bytes, offset, nameLength, 'peer name') : undefined
  offset += nameLength
  const signingPubkey = signingLength
    ? readString(bytes, offset, signingLength, 'signing public key')
    : undefined
  return {
    kind: INNER_FRAME_KIND.hello,
    version: bytes[1],
    pubkey: Buffer.from(pubkey).toString('base64'),
    ...(pinnedPubkey ? { pinnedPubkey } : {}),
    ...(name ? { name } : {}),
    ...(signingPubkey ? { signingPubkey } : {}),
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

export function legacyV1WireBytesForStreamData(data: Uint8Array): number {
  const legacyInner = JSON.stringify({
    kind: 'stream_data',
    streamId: 'c1',
    seq: 0,
    data: Buffer.from(data).toString('base64'),
  })
  const legacyCiphertext = Buffer.from(legacyInner).toString('base64')
  return Buffer.byteLength(
    JSON.stringify({
      version: 1,
      roomId: 'room_compare',
      seq: 0,
      kind: 'relay_data_frame',
      payload: { ciphertext: legacyCiphertext },
    }),
  )
}
