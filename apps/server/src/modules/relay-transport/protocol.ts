export type {
  FabricSessionEnvelope,
  FabricSessionEnvelopeKind,
  InnerFrame,
  RelayErrorPayload,
  RelayPeerClosedPayload,
  RelayPriority,
} from '@cradle/fabric-protocol'
export {
  decodeFabricSessionEnvelope,
  decodeInnerFrame,
  decodeRelayErrorPayload,
  decodeRelayPeerClosedPayload,
  encodeFabricSessionEnvelope,
  encodeInnerFrame,
  encodeRelayControlPayload,
  FABRIC_SESSION_ENVELOPE_KIND,
  FABRIC_SESSION_PROTOCOL_VERSION,
  INNER_FRAME_KIND,
  RELAY_CONNECTION_MAX_CREDIT_BYTES,
  RELAY_MAX_FRAME_BYTES,
  RELAY_MAX_STREAM_CHUNK_BYTES,
  RELAY_STREAM_MAX_CREDIT_BYTES,
  RELAY_STREAM_MIN_CREDIT_BYTES,
  relayPriorityForInnerFrame,
} from '@cradle/fabric-protocol'

/** Benchmark-only reference size; Fabric never accepts or emits this format. */
export function referenceJsonWireBytesForStreamData(data: Uint8Array): number {
  const referenceInner = JSON.stringify({
    kind: 'stream_data',
    streamId: 'benchmark',
    seq: 0,
    data: Buffer.from(data).toString('base64'),
  })
  const referenceCiphertext = Buffer.concat([
    Buffer.alloc(24),
    Buffer.from(referenceInner),
    Buffer.alloc(16),
  ]).toString('base64')
  return Buffer.byteLength(JSON.stringify({
    version: 1,
    linkId: 'fabric-benchmark-link',
    seq: 0,
    kind: 'relay_data_frame',
    payload: { ciphertext: referenceCiphertext },
  }))
}
