import { z } from 'zod'

import {
  REMOTE_AGENT_PROTOCOL_VERSION,
  remoteAgentStreamMethods,
  remoteAgentUnaryMethods,
  type RemoteAgentStreamMethod,
  type RemoteAgentUnaryMethod,
} from './methods'

const protocolVersionSchema = z.literal(REMOTE_AGENT_PROTOCOL_VERSION)
const idSchema = z.string().min(1)
const payloadSchema = z.unknown()

export const remoteAgentProtocolErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
})

export type RemoteAgentProtocolError = z.infer<typeof remoteAgentProtocolErrorSchema>

const unaryMethodSchema = z.enum(remoteAgentUnaryMethods)
const streamMethodSchema = z.enum(remoteAgentStreamMethods)

export const remoteAgentRequestFrameSchema = z.object({
  protocolVersion: protocolVersionSchema,
  kind: z.literal('rpc.request'),
  id: idSchema,
  method: unaryMethodSchema,
  params: payloadSchema,
})

export const remoteAgentResponseFrameSchema = z.object({
  protocolVersion: protocolVersionSchema,
  kind: z.literal('rpc.response'),
  id: idSchema,
  result: payloadSchema,
})

export const remoteAgentErrorFrameSchema = z.object({
  protocolVersion: protocolVersionSchema,
  kind: z.literal('rpc.error'),
  id: idSchema,
  error: remoteAgentProtocolErrorSchema,
})

export const remoteAgentStreamOpenFrameSchema = z.object({
  protocolVersion: protocolVersionSchema,
  kind: z.literal('stream.open'),
  streamId: idSchema,
  method: streamMethodSchema,
  params: payloadSchema,
})

export const remoteAgentStreamNextFrameSchema = z.object({
  protocolVersion: protocolVersionSchema,
  kind: z.literal('stream.next'),
  streamId: idSchema,
  value: payloadSchema,
})

export const remoteAgentStreamErrorFrameSchema = z.object({
  protocolVersion: protocolVersionSchema,
  kind: z.literal('stream.error'),
  streamId: idSchema,
  error: remoteAgentProtocolErrorSchema,
})

export const remoteAgentStreamCloseFrameSchema = z.object({
  protocolVersion: protocolVersionSchema,
  kind: z.literal('stream.close'),
  streamId: idSchema,
})

export const remoteAgentNotificationFrameSchema = z.object({
  protocolVersion: protocolVersionSchema,
  kind: z.literal('notification'),
  method: z.string().min(1),
  params: payloadSchema,
})

export const remoteAgentFrameSchema = z.discriminatedUnion('kind', [
  remoteAgentRequestFrameSchema,
  remoteAgentResponseFrameSchema,
  remoteAgentErrorFrameSchema,
  remoteAgentStreamOpenFrameSchema,
  remoteAgentStreamNextFrameSchema,
  remoteAgentStreamErrorFrameSchema,
  remoteAgentStreamCloseFrameSchema,
  remoteAgentNotificationFrameSchema,
])

export type RemoteAgentRequestFrame = z.infer<typeof remoteAgentRequestFrameSchema> & {
  method: RemoteAgentUnaryMethod
}
export type RemoteAgentResponseFrame = z.infer<typeof remoteAgentResponseFrameSchema>
export type RemoteAgentErrorFrame = z.infer<typeof remoteAgentErrorFrameSchema>
export type RemoteAgentStreamOpenFrame = z.infer<typeof remoteAgentStreamOpenFrameSchema> & {
  method: RemoteAgentStreamMethod
}
export type RemoteAgentStreamNextFrame = z.infer<typeof remoteAgentStreamNextFrameSchema>
export type RemoteAgentStreamErrorFrame = z.infer<typeof remoteAgentStreamErrorFrameSchema>
export type RemoteAgentStreamCloseFrame = z.infer<typeof remoteAgentStreamCloseFrameSchema>
export type RemoteAgentNotificationFrame = z.infer<typeof remoteAgentNotificationFrameSchema>
export type RemoteAgentStreamFrame =
  | RemoteAgentStreamOpenFrame
  | RemoteAgentStreamNextFrame
  | RemoteAgentStreamErrorFrame
  | RemoteAgentStreamCloseFrame
export type RemoteAgentFrame = z.infer<typeof remoteAgentFrameSchema>

export function parseRemoteAgentFrame(input: unknown): RemoteAgentFrame {
  const raw = typeof input === 'string' ? JSON.parse(input) : input
  return remoteAgentFrameSchema.parse(raw)
}

export function encodeRemoteAgentFrame(frame: RemoteAgentFrame): string {
  return JSON.stringify(remoteAgentFrameSchema.parse(frame))
}

export function createRemoteAgentError(code: string, message: string, details?: unknown): RemoteAgentProtocolError {
  return {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  }
}
