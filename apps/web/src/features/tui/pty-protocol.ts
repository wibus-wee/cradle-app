import { z } from 'zod'

export type PtyClientEvent
  = | { type: 'input', data: string }
    | { type: 'resize', cols: number, rows: number }
    | { type: 'ping' }

export type PtyActivityState = 'unknown' | 'idle' | 'working' | 'blocked'

export type PtyActivitySource = 'unknown' | 'osc-9999'

export type PtyRestoreInfo = {
  mode: 'live-attach' | 'resume' | 'fresh' | 'history'
  agent?: string
  reason?: string
}

export type PtySnapshotEvent = {
  type: 'snapshot'
  seq: number
  buffer: string
  running: boolean
  activity?: PtyActivityState
  activitySource?: PtyActivitySource
  restore?: PtyRestoreInfo
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

export type PtyStatusEvent = {
  type: 'status'
  seq: number
  state: PtyActivityState
  source: PtyActivitySource
  agent?: string
  prompt?: string
}

export type PtyPongEvent = { type: 'pong' }

export type PtyErrorEvent = {
  type: 'error'
  code: string
  message: string
}

export type PtyServerEvent = PtySnapshotEvent | PtyOutputEvent | PtyExitEvent | PtyStatusEvent | PtyPongEvent | PtyErrorEvent

export const PtyServerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    seq: z.number().finite(),
    buffer: z.string(),
    running: z.boolean(),
    activity: z.enum(['unknown', 'idle', 'working', 'blocked']).optional(),
    activitySource: z.enum(['unknown', 'osc-9999']).optional(),
    restore: z.object({
      mode: z.enum(['live-attach', 'resume', 'fresh', 'history']),
      agent: z.string().optional(),
      reason: z.string().optional(),
    }).optional(),
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
    type: z.literal('status'),
    seq: z.number().finite(),
    state: z.enum(['unknown', 'idle', 'working', 'blocked']),
    source: z.enum(['unknown', 'osc-9999']),
    agent: z.string().optional(),
    prompt: z.string().optional(),
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
