import { z } from 'zod'

/**
 * Relay transport protocol — mirrors the relayd envelope
 * (apps/relayd/internal/relay/envelope.go) and defines the inner frame
 * schemas that ride inside `relay_data_frame.payload`.
 *
 * The envelope is the only thing relayd can see. After the `hello` handshake
 * every inner frame is encrypted (see crypto.ts), so `payload` is an opaque
 * base64 ciphertext to the relay.
 */

export const RELAY_PROTOCOL_VERSION = 1

/** Maximum bytes of a single relayd WebSocket frame (mirrors relayd default). */
export const RELAY_MAX_FRAME_BYTES = 1 << 20 // 1 MiB

/** Maximum bytes of a single inner stream_data chunk (stays under frame cap). */
export const RELAY_MAX_STREAM_CHUNK_BYTES = 256 * 1024 // 256 KiB

/** relayd envelope `kind` values — must match envelope.go. */
export const RELAY_ENVELOPE_KIND = {
  dataFrame: 'relay_data_frame',
  peerClosed: 'relay_peer_closed',
  relayError: 'relay_error',
} as const

export type RelayEnvelopeKind
  = | typeof RELAY_ENVELOPE_KIND.dataFrame
    | typeof RELAY_ENVELOPE_KIND.peerClosed
    | typeof RELAY_ENVELOPE_KIND.relayError

/** Outer envelope as relayd forwards it. `payload` is a raw JSON value. */
export const relayEnvelopeSchema = z.object({
  version: z.literal(RELAY_PROTOCOL_VERSION),
  roomId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ack: z.number().int().nonnegative().optional(),
  kind: z.enum([
    RELAY_ENVELOPE_KIND.dataFrame,
    RELAY_ENVELOPE_KIND.peerClosed,
    RELAY_ENVELOPE_KIND.relayError,
  ]),
  streamId: z.string().optional(),
  payload: z.unknown(),
})

export type RelayEnvelope = z.infer<typeof relayEnvelopeSchema>

/** relayd peer-closed control payload. */
export const peerClosedPayloadSchema = z.object({
  role: z.string().optional(),
  reason: z.string().optional(),
}).passthrough()

export type PeerClosedPayload = z.infer<typeof peerClosedPayloadSchema>

/** relayd error control payload. */
export const relayErrorPayloadSchema = z.object({
  error: z.string().optional(),
}).passthrough()

export type RelayErrorPayload = z.infer<typeof relayErrorPayloadSchema>

// ── Inner frames (plaintext, encrypted in transit after hello) ──

export const INNER_FRAME_KIND = {
  hello: 'hello',
  helloConfirm: 'hello_confirm',
  streamOpen: 'stream_open',
  streamData: 'stream_data',
  streamAck: 'stream_ack',
  streamClose: 'stream_close',
} as const

export type InnerFrameKind
  = | typeof INNER_FRAME_KIND.hello
    | typeof INNER_FRAME_KIND.helloConfirm
    | typeof INNER_FRAME_KIND.streamOpen
    | typeof INNER_FRAME_KIND.streamData
    | typeof INNER_FRAME_KIND.streamAck
    | typeof INNER_FRAME_KIND.streamClose

/**
 * Handshake step 1: exchange X25519 public keys.
 *
 * - `pubkey`: this peer's X25519 public key (base64, 32 bytes).
 * - `pinnedPubkey`: the public key this peer expects from the other side. Sent
 *   on reconnect so a peer can refuse a key rotation it did not initiate.
 *   Empty/absent on first pairing.
 * - `name`: optional human-readable label for this peer (e.g. the controller's
 *   machine name), so the other side can show "paired with X" instead of just a
 *   fingerprint. Sent in plaintext alongside the pubkey — keep it non-sensitive.
 * - `signingPubkey`: optional Ed25519 relay assertion public key. The host
 *   persists the controller value after first pairing so it can restore relayd
 *   room controller authorization after relayd restarts.
 *   Unknown keys are stripped by Zod, so old peers ignore it (backward compatible).
 *
 * Note: the pairing `confirm` cannot ride in this frame — it is an HMAC over a
 * transcript that includes *both* public keys, which each peer only knows once
 * it has received the other's `hello`. So the proof is sent separately in
 * `hello_confirm` (first pairing only; reconnect relies on pinned-pubkey
 * verification and skips it).
 */
export const helloFrameSchema = z.object({
  kind: z.literal(INNER_FRAME_KIND.hello),
  version: z.number().int().nonnegative(),
  pubkey: z.string().min(1),
  pinnedPubkey: z.string().optional(),
  name: z.string().max(128).optional(),
  signingPubkey: z.string().min(1).optional(),
})

/**
 * Handshake step 2 (first pairing only): prove knowledge of the pairing code.
 *
 * `confirm` = HMAC(confirmKey, canonicalTranscript) where the transcript is
 * role-tagged so both sides compute the identical value:
 *   "controller" || controllerPub || "host" || hostPub || sharedSecret
 * A relay MITM that substitutes public keys during pairing breaks the ECDH
 * secret, and thus the confirmKey and confirm, so the honest peer rejects.
 */
export const helloConfirmFrameSchema = z.object({
  kind: z.literal(INNER_FRAME_KIND.helloConfirm),
  confirm: z.string().min(1),
})

export const streamOpenFrameSchema = z.object({
  kind: z.literal(INNER_FRAME_KIND.streamOpen),
  streamId: z.string().min(1),
})

export const streamDataFrameSchema = z.object({
  kind: z.literal(INNER_FRAME_KIND.streamData),
  streamId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  data: z.string().min(1), // base64
})

export const streamAckFrameSchema = z.object({
  kind: z.literal(INNER_FRAME_KIND.streamAck),
  streamId: z.string().min(1),
  ackedBytes: z.number().int().nonnegative(),
})

export const streamCloseFrameSchema = z.object({
  kind: z.literal(INNER_FRAME_KIND.streamClose),
  streamId: z.string().min(1),
  reason: z.string().optional(),
})

export const innerFrameSchema = z.discriminatedUnion('kind', [
  helloFrameSchema,
  helloConfirmFrameSchema,
  streamOpenFrameSchema,
  streamDataFrameSchema,
  streamAckFrameSchema,
  streamCloseFrameSchema,
])

export type InnerFrame = z.infer<typeof innerFrameSchema>
export type HelloFrame = z.infer<typeof helloFrameSchema>
export type HelloConfirmFrame = z.infer<typeof helloConfirmFrameSchema>
export type StreamOpenFrame = z.infer<typeof streamOpenFrameSchema>
export type StreamDataFrame = z.infer<typeof streamDataFrameSchema>
export type StreamAckFrame = z.infer<typeof streamAckFrameSchema>
export type StreamCloseFrame = z.infer<typeof streamCloseFrameSchema>

/**
 * The on-the-wire form of an inner frame on the controller<->host tunnel:
 * a length-prefixed ciphertext blob. We serialize the plaintext frame as JSON,
 * encrypt it, and wrap as `{ ciphertext: base64 }`. This wrapper is what goes
 * into `relay_data_frame.payload`.
 */
export const encryptedPayloadSchema = z.object({
  ciphertext: z.string().min(1), // base64 (nonce || tag || ciphertext)
})

export type EncryptedPayload = z.infer<typeof encryptedPayloadSchema>

/** Default high-water mark for credit-based flow control (see session.ts). */
export const RELAY_STREAM_CREDIT_BYTES = 512 * 1024 // 512 KiB unacked window

/**
 * Prefix a streamId with a role tag so controller-initiated and host-initiated
 * stream ids never collide. Only the controller opens streams in v1, but the
 * prefix keeps the namespace safe for future bidirectional use.
 */
export function controllerStreamId(n: number): string {
  return `c${n}`
}
