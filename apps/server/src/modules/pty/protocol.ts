export interface PtyExitState {
  exitCode: number | null
  signal: string | null
}

export type PtyActivityState = 'unknown' | 'idle' | 'working' | 'blocked'

export type PtyActivitySource = 'unknown' | 'osc-9999'

export type PtyClientEvent
  = | { type: 'input', data: string }
    | { type: 'resize', cols: number, rows: number }
    | { type: 'ping' }

export type PtyRestoreMode = 'live-attach' | 'resume' | 'fresh' | 'history'

export type PtyRestoreInfo = {
  mode: PtyRestoreMode
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

export type PtyTimelineEvent = PtyOutputEvent | PtyExitEvent | PtyStatusEvent

export type PtyServerEvent
  = | PtySnapshotEvent
    | PtyOutputEvent
    | PtyExitEvent
    | PtyStatusEvent
    | { type: 'pong' }
    | { type: 'error', code: string, message: string }
