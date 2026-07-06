import type {
  ChatGlobalSessionTailEvent,
  ChatSessionTailEvent,
  SyncClientSubFrame,
} from '@cradle/chat-runtime-contracts'

import {
  replayChatGlobalSessionTail,
  replayChatSessionTail,
  subscribeChatGlobalSessionTail,
  subscribeChatSessionTail,
} from '../chat-runtime/es/event-tail'
import {
  hasActiveSessionRun,
  readSessionRunChunkReplay,
  subscribeSessionRunChunks,
} from '../chat-runtime/stream/session-run-chunk-sync'
import type { SyncSubscriptionSender } from './buffer'
import {
  SYNC_CHUNK_BUFFER_MAX,
  SYNC_CHUNK_BUFFER_MAX_BYTES,
  SYNC_TAIL_EVENT_BUFFER_MAX,
} from './buffer'

export function attachSyncSubscription(
  frame: SyncClientSubFrame,
  sender: SyncSubscriptionSender,
): () => void {
  switch (frame.channel) {
    case 'sessions-tail':
      return attachSessionsTail(frame, sender)
    case 'session-tail':
      return attachSessionTail(frame, sender)
    case 'run-chunks':
      return attachRunChunks(frame, sender)
    case 'workspace-files':
      sender.end('error', 'workspace-files channel is not implemented yet')
      return () => {}
    default:
      sender.end('error', 'Unknown sync channel')
      return () => {}
  }
}

function attachSessionsTail(
  frame: Extract<SyncClientSubFrame, { channel: 'sessions-tail' }>,
  sender: SyncSubscriptionSender,
): () => void {
  const workspaceId = frame.workspaceId?.trim() || null
  const replay = replayChatGlobalSessionTail({
    afterSequenceId: frame.afterSequenceId,
    workspaceId,
  })

  sendGlobalTailReplay(frame.subId, sender, replay.events, replay.snapshotRequired)
  sender.send({ subId: frame.subId, kind: 'sub-ack', cursor: replay.cursor })

  if (replay.snapshotRequired) {
    sender.end('snapshot-required')
    return () => {}
  }

  let liveSeq = replay.cursor
  return subscribeChatGlobalSessionTail(workspaceId, (event) => {
    if (event.sequenceId <= liveSeq) {
      return
    }
    liveSeq = event.sequenceId
    sender.send({ subId: frame.subId, kind: 'tail-event', event })
  })
}

function attachSessionTail(
  frame: Extract<SyncClientSubFrame, { channel: 'session-tail' }>,
  sender: SyncSubscriptionSender,
): () => void {
  const replay = replayChatSessionTail({
    sessionId: frame.sessionId,
    afterVersion: frame.afterVersion,
  })

  sendSessionTailReplay(frame.subId, sender, replay.events, replay.snapshotRequired)
  sender.send({ subId: frame.subId, kind: 'sub-ack', cursor: replay.cursor })

  if (replay.snapshotRequired) {
    sender.end('snapshot-required')
    return () => {}
  }

  let liveVersion = replay.cursor
  return subscribeChatSessionTail(frame.sessionId, (event) => {
    if (event.version <= liveVersion) {
      return
    }
    liveVersion = event.version
    sender.send({ subId: frame.subId, kind: 'tail-event', event })
  })
}

function attachRunChunks(
  frame: Extract<SyncClientSubFrame, { channel: 'run-chunks' }>,
  sender: SyncSubscriptionSender,
): () => void {
  const afterChunkSeq = frame.afterChunkSeq ?? -1
  const replay = readSessionRunChunkReplay(frame.sessionId, afterChunkSeq)

  let lastSeq = afterChunkSeq
  for (const item of replay.items) {
    sender.send({
      subId: frame.subId,
      kind: 'chunk',
      chunk: item.chunk,
      terminal: item.terminal,
      replay: true,
    })
    lastSeq = item.seq
    if (item.terminal) {
      sender.send({ subId: frame.subId, kind: 'sub-ack', cursor: item.seq })
      sender.end('terminal')
      return () => {}
    }
  }

  sender.send({ subId: frame.subId, kind: 'sub-ack', cursor: replay.cursor })

  if (!replay.live || !hasActiveSessionRun(frame.sessionId)) {
    sender.end('upstream-closed')
    return () => {}
  }

  let nextSeq = lastSeq + 1
  return subscribeSessionRunChunks(frame.sessionId, (chunk, terminal) => {
    sender.send({
      subId: frame.subId,
      kind: 'chunk',
      chunk,
      terminal,
      replay: false,
    })
    nextSeq += 1
    if (terminal) {
      sender.send({ subId: frame.subId, kind: 'sub-ack', cursor: nextSeq - 1 })
      sender.end('terminal')
    }
  })
}

function sendSessionTailReplay(
  subId: string,
  sender: SyncSubscriptionSender,
  events: ChatSessionTailEvent[],
  snapshotRequired: ChatSessionTailEvent | null,
): void {
  for (const event of events) {
    sender.send({ subId, kind: 'tail-event', event })
  }
  if (snapshotRequired) {
    sender.send({ subId, kind: 'tail-event', event: snapshotRequired })
  }
}

function sendGlobalTailReplay(
  subId: string,
  sender: SyncSubscriptionSender,
  events: ChatGlobalSessionTailEvent[],
  snapshotRequired: ChatGlobalSessionTailEvent | null,
): void {
  for (const event of events) {
    sender.send({ subId, kind: 'tail-event', event })
  }
  if (snapshotRequired) {
    sender.send({ subId, kind: 'tail-event', event: snapshotRequired })
  }
}

export function readTailBufferLimits(): { maxFrames: number } {
  return { maxFrames: SYNC_TAIL_EVENT_BUFFER_MAX }
}

export function readChunkBufferLimits(): { maxFrames: number, maxBytes: number } {
  return {
    maxFrames: SYNC_CHUNK_BUFFER_MAX,
    maxBytes: SYNC_CHUNK_BUFFER_MAX_BYTES,
  }
}
