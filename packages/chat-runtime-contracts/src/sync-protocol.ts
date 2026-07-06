import type { UIMessageChunk } from 'ai'

import type { ChatGlobalSessionTailEvent, ChatSessionTailEvent } from './index'

export type SyncChannelKind
  = | 'sessions-tail'
    | 'session-tail'
    | 'run-chunks'
    | 'workspace-files'

export type SyncEndReason
  = | 'terminal'
    | 'snapshot-required'
    | 'backpressure'
    | 'not-found'
    | 'upstream-closed'
    | 'error'

export type SyncClientSubFrame
  = | {
    op: 'sub'
    subId: string
    channel: 'sessions-tail'
    afterSequenceId: number
    workspaceId?: string
  }
  | {
    op: 'sub'
    subId: string
    channel: 'session-tail'
    sessionId: string
    afterVersion: number
  }
  | {
    op: 'sub'
    subId: string
    channel: 'run-chunks'
    sessionId: string
    afterChunkSeq?: number
  }
  | {
    op: 'sub'
    subId: string
    channel: 'workspace-files'
    workspaceId: string
  }

export type SyncClientFrame
  = | SyncClientSubFrame
    | { op: 'unsub', subId: string }
    | { op: 'ping', ts: number }

export type SyncServerDataFrame
  = | { subId: string, seq?: number, kind: 'tail-event', event: ChatSessionTailEvent | ChatGlobalSessionTailEvent }
    | { subId: string, seq?: number, kind: 'chunk', chunk: UIMessageChunk, terminal?: boolean, replay?: boolean }
    | { subId: string, seq?: number, kind: 'file-event', event: SyncWorkspaceFileChangeEvent }
    | { subId: string, kind: 'sub-ack', cursor: number }
    | { subId: string, kind: 'end', reason: SyncEndReason, detail?: string }

export type SyncServerFrame
  = | SyncServerDataFrame
    | { op: 'pong', ts: number }
    | { op: 'error', code: string, message: string }

export interface SyncWorkspaceFileChangeEvent {
  type: 'directory-changed'
  workspaceId: string
  path: string
  reason: 'direct' | 'ancestor'
  timestamp: number
}
