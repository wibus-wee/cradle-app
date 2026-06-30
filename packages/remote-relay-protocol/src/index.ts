import { z } from 'zod'

export const REMOTE_RELAY_PROTOCOL_VERSION = 1

export const relayEnvelopeKinds = [
  'remote_agent_frame',
  'relay_peer_closed',
  'relay_error',
] as const

export const relayRoleSchema = z.enum(['host', 'controller'])
export type RelayRole = z.infer<typeof relayRoleSchema>

export const relayEnvelopeKindSchema = z.enum(relayEnvelopeKinds)
export type RelayEnvelopeKind = z.infer<typeof relayEnvelopeKindSchema>

const payloadSchema = z.unknown()

export const relayEnvelopeSchema = z.object({
  version: z.literal(REMOTE_RELAY_PROTOCOL_VERSION),
  roomId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ack: z.number().int().nonnegative().optional(),
  kind: relayEnvelopeKindSchema,
  streamId: z.string().min(1).optional(),
  payload: payloadSchema,
})

export type RelayEnvelope = z.infer<typeof relayEnvelopeSchema>

export const relayPeerClosedPayloadSchema = z.object({
  role: relayRoleSchema,
  reason: z.string().min(1),
})

export type RelayPeerClosedPayload = z.infer<typeof relayPeerClosedPayloadSchema>

export const relayErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
})

export type RelayErrorPayload = z.infer<typeof relayErrorPayloadSchema>

export function parseRelayEnvelope(input: unknown): RelayEnvelope {
  const raw = typeof input === 'string' ? JSON.parse(input) : input
  return relayEnvelopeSchema.parse(raw)
}

export function encodeRelayEnvelope(envelope: RelayEnvelope): string {
  return JSON.stringify(relayEnvelopeSchema.parse(envelope))
}
