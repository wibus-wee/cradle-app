export interface PtyExitState {
  exitCode: number | null
  signal: string | null
}

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

export type PtyTimelineEvent = PtyOutputEvent | PtyExitEvent

export type PtyServerEvent
  = | PtySnapshotEvent
    | PtyOutputEvent
    | PtyExitEvent
    | { type: 'pong' }
    | { type: 'error', code: string, message: string }
