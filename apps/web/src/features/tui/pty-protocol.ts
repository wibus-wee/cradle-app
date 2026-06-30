import { z } from 'zod'

export type PtyClientEvent
  = | { type: 'input', data: string }
    | { type: 'resize', cols: number, rows: number }
    | { type: 'ping' }

export type PtySnapshotEvent = {
  type: 'snapshot'
  seq: number
  buffer: string
  running: boolean
}

export type PtyOutputEvent = {
  type: 'output'
  seq: number
  data: string
}

export type PtyExitEvent = {
  type: 'exit'
  seq: number
  exitCode: number | null
  signal: string | null
}

export type PtyPongEvent = { type: 'pong' }

export type PtyErrorEvent = {
  type: 'error'
  code: string
  message: string
}

export type PtyServerEvent = PtySnapshotEvent | PtyOutputEvent | PtyExitEvent | PtyPongEvent | PtyErrorEvent

export const PtyServerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    seq: z.number().finite(),
    buffer: z.string(),
    running: z.boolean(),
  }),
  z.object({
    type: z.literal('output'),
    seq: z.number().finite(),
    data: z.string(),
  }),
  z.object({
    type: z.literal('exit'),
    seq: z.number().finite(),
    exitCode: z.number().finite().nullable(),
    signal: z.string().nullable(),
  }),
  z.object({
    type: z.literal('pong'),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
])
export const PtyServerEventJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(PtyServerEventSchema)
