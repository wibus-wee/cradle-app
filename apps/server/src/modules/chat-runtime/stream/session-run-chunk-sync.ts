import type { UIMessageChunk } from 'ai'

import { isTerminalUIMessageChunk } from '../run/stream-chunks'
import { runRegistry } from '../run-registry'
import { runSubscribers } from './live-run-streams'
import type { ChunkSubscriber } from './subscriber-registry'

export interface SessionRunChunkReplayItem {
  seq: number
  chunk: UIMessageChunk
  terminal: boolean
}

export interface SessionRunChunkReplay {
  items: SessionRunChunkReplayItem[]
  cursor: number
  live: boolean
}

export function readSessionRunChunkReplay(
  sessionId: string,
  afterChunkSeq: number,
): SessionRunChunkReplay {
  const runId = runRegistry.getActiveRunIdForSession(sessionId)
  if (!runId) {
    return { items: [], cursor: afterChunkSeq, live: false }
  }

  const active = runRegistry.getActiveRun(runId)
  const chunks = active?.chunkBuffer ?? []
  const startSeq = Math.max(0, Math.floor(afterChunkSeq) + 1)
  return buildReplayFromIndex(chunks, startSeq)
}

function buildReplayFromIndex(chunks: UIMessageChunk[], startSeq: number): SessionRunChunkReplay {
  const items: SessionRunChunkReplayItem[] = []
  for (let seq = startSeq; seq < chunks.length; seq++) {
    const chunk = chunks[seq]!
    const terminal = isTerminalUIMessageChunk(chunk)
    items.push({ seq, chunk, terminal })
    if (terminal) {
      return { items, cursor: seq, live: false }
    }
  }
  const cursor = chunks.length > 0 ? chunks.length - 1 : Math.max(0, startSeq - 1)
  return { items, cursor, live: chunks.length > 0 }
}

export function subscribeSessionRunChunks(
  sessionId: string,
  subscriber: ChunkSubscriber,
): () => void {
  const runId = runRegistry.getActiveRunIdForSession(sessionId)
  if (!runId) {
    return () => {}
  }
  return runSubscribers.subscribe(runId, subscriber)
}

export function hasActiveSessionRun(sessionId: string): boolean {
  return runRegistry.getActiveRunIdForSession(sessionId) !== null
}
