import type { UIMessageChunk } from 'ai'

import { readPositiveIntegerEnv } from '../../../helpers/env'
import { currentUnixSeconds } from '../../../helpers/time'
import { compactStoredMessageSnapshot } from '../message-snapshot-compaction'
import {
  flushFinalMessageProjection,
  projectFinalMessageChunk,
} from '../run/final-message-projection'
import type { RunWriteFence } from '../run/run-write-fence'
import { readRunWriteFence } from '../run/run-write-fence'
import { readChunkTraceToolCallId } from '../run/snapshot-events'
import {
  mergeBufferedStreamChunk,
  mergeRuntimeDeltaChunk,
  readDeltaChunkTextLength,
  readReplayCoalesceKey,
  readRunDeltaCoalesceKey,
} from '../run/stream-chunks'
import type { ActiveRun } from '../run-registry'
import { runRegistry } from '../run-registry'
import { isChatStreamTraceEnabled, recordChatStreamTrace } from '../stream-trace'
import { normalizeMessageSnapshot } from '../ui-message'
import { upsertRunStreamCheckpoint } from './checkpoint-store'
import {
  DEFAULT_RUN_DELTA_FLUSH_CHARS,
  DEFAULT_RUN_DELTA_FLUSH_MS,
  DEFAULT_RUN_REPLAY_CHUNKS,
  DEFAULT_SNAPSHOT_INTERVAL_MS,
} from './constants'
import { runSubscribers } from './live-run-streams'

export interface ActiveRunStreamControllerDeps {
  releaseStaleActiveRun: (activeRun: ActiveRun, fence: RunWriteFence) => void
  error: (message: string, payload?: Record<string, unknown>) => void
}

export interface ActiveRunStreamController {
  snapshotActiveRun: (activeRun: ActiveRun) => Promise<void>
  startSnapshotTimer: (activeRun: ActiveRun) => void
  stopSnapshotTimer: (activeRun: ActiveRun) => void
  stopPendingRunDeltaFlush: (activeRun: ActiveRun) => void
  flushAllActiveRunSnapshots: () => Promise<void>
  publishRuntimeChunk: (activeRun: ActiveRun, chunk: UIMessageChunk) => void
  flushPendingRunDelta: (activeRun: ActiveRun) => void
  publishUIMessageChunk: (activeRun: ActiveRun, chunk: UIMessageChunk, terminal: boolean) => void
  publishRunStartChunk: (activeRun: ActiveRun) => void
}

export function createActiveRunStreamController(
  deps: ActiveRunStreamControllerDeps,
): ActiveRunStreamController {
  async function snapshotActiveRun(activeRun: ActiveRun): Promise<void> {
    if (activeRun.terminalStatus) {
      return
    }
    try {
      flushFinalMessageProjection(activeRun)
      await persistStreamingMessageSnapshot(activeRun)
    }
 catch (error) {
      deps.error('failed to snapshot active chat run', {
        error,
        sessionId: activeRun.sessionId,
        runId: activeRun.runId,
        messageId: activeRun.messageId,
      })
    }
  }

  // Fenced streaming checkpoint writer. Upserts ephemeral run_stream_checkpoints
  // state (not a domain fact). The persisted run row is checked before writing
  // so a stale active run cannot overwrite after a terminal projection has won.
  // `messages` is NOT touched here — projections are written only by projectors
  // reacting to facts; partial content is overlaid at the history read path.
  async function persistStreamingMessageSnapshot(activeRun: ActiveRun): Promise<void> {
    const fence = readRunWriteFence(activeRun.runId)
    if (fence.status === 'streaming') {
      const message = compactStoredMessageSnapshot(normalizeMessageSnapshot(activeRun.finalMessage))
      const messageJson = JSON.stringify(message)
      if (
        activeRun.lastStreamingSnapshotMessageJson === messageJson
        || activeRun.pendingStreamingSnapshotMessageJson === messageJson
      ) {
        return
      }

      activeRun.pendingStreamingSnapshotMessageJson = messageJson
      try {
        upsertRunStreamCheckpoint({
          runId: activeRun.runId,
          sessionId: activeRun.sessionId,
          messageId: activeRun.messageId,
          messageJson,
          chunkSeq: 0,
          updatedAt: currentUnixSeconds(),
        })
        activeRun.lastStreamingSnapshotMessageJson = messageJson
      }
 catch (error) {
        const latestFence = readRunWriteFence(activeRun.runId)
        if (latestFence.status !== 'streaming') {
          deps.releaseStaleActiveRun(activeRun, latestFence)
          return
        }
        deps.error('failed to persist streaming message checkpoint', {
          error,
          sessionId: activeRun.sessionId,
          runId: activeRun.runId,
          messageId: activeRun.messageId,
        })
      }
 finally {
        if (activeRun.pendingStreamingSnapshotMessageJson === messageJson) {
          activeRun.pendingStreamingSnapshotMessageJson = null
        }
      }
      return
    }

    // Run is already terminal or gone: a stale active run continued after
    // recovery. Stop writing and release it. The persisted terminal fact wins.
    deps.releaseStaleActiveRun(activeRun, fence)
  }

  function startSnapshotTimer(activeRun: ActiveRun): void {
    stopSnapshotTimer(activeRun)
    activeRun.snapshotTimer = setInterval(() => {
      void snapshotActiveRun(activeRun)
    }, readPositiveIntegerEnv('CRADLE_CHAT_SNAPSHOT_INTERVAL_MS', DEFAULT_SNAPSHOT_INTERVAL_MS))
  }

  function stopSnapshotTimer(activeRun: ActiveRun): void {
    if (activeRun.snapshotTimer) {
      clearInterval(activeRun.snapshotTimer)
      activeRun.snapshotTimer = null
    }
  }

  function stopPendingRunDeltaFlush(activeRun: ActiveRun): void {
    if (activeRun.pendingDeltaFlushTimer) {
      clearTimeout(activeRun.pendingDeltaFlushTimer)
      activeRun.pendingDeltaFlushTimer = null
    }
  }

  async function flushAllActiveRunSnapshots(): Promise<void> {
    await Promise.all(runRegistry.listActiveRuns().map(async (activeRun) => {
      try {
        await snapshotActiveRun(activeRun)
      }
 catch {
        // best-effort on shutdown
      }
    }))
  }

  function publishRuntimeChunk(activeRun: ActiveRun, chunk: UIMessageChunk): void {
    const pending = activeRun.pendingDeltaChunk
    if (!pending) {
      if (readRunDeltaCoalesceKey(chunk)) {
        activeRun.pendingDeltaChunk = chunk
        schedulePendingRunDeltaFlush(activeRun)
        return
      }
      publishUIMessageChunk(activeRun, chunk, false)
      return
    }

    const merged = mergeRuntimeDeltaChunk(pending, chunk)
    if (merged) {
      activeRun.pendingDeltaChunk = merged
      if (
        readDeltaChunkTextLength(merged)
        >= readPositiveIntegerEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS', DEFAULT_RUN_DELTA_FLUSH_CHARS)
      ) {
        flushPendingRunDelta(activeRun)
        return
      }
      schedulePendingRunDeltaFlush(activeRun)
      return
    }

    flushPendingRunDelta(activeRun)
    if (readRunDeltaCoalesceKey(chunk)) {
      activeRun.pendingDeltaChunk = chunk
      schedulePendingRunDeltaFlush(activeRun)
      return
    }
    publishUIMessageChunk(activeRun, chunk, false)
  }

  function schedulePendingRunDeltaFlush(activeRun: ActiveRun): void {
    if (activeRun.pendingDeltaFlushTimer) {
      return
    }
    activeRun.pendingDeltaFlushTimer = setTimeout(
      () => {
        activeRun.pendingDeltaFlushTimer = null
        flushPendingRunDelta(activeRun)
      },
      readPositiveIntegerEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_MS', DEFAULT_RUN_DELTA_FLUSH_MS),
    )
  }

  function flushPendingRunDelta(activeRun: ActiveRun): void {
    if (activeRun.pendingDeltaFlushTimer) {
      clearTimeout(activeRun.pendingDeltaFlushTimer)
      activeRun.pendingDeltaFlushTimer = null
    }
    const chunk = activeRun.pendingDeltaChunk
    activeRun.pendingDeltaChunk = null
    if (chunk && !activeRun.terminalStatus) {
      const fence = readRunWriteFence(activeRun.runId)
      if (fence.status !== 'streaming') {
        deps.releaseStaleActiveRun(activeRun, fence)
        return
      }
      publishUIMessageChunk(activeRun, chunk, false)
    }
  }

  function publishUIMessageChunk(
    activeRun: ActiveRun,
    chunk: UIMessageChunk,
    terminal: boolean,
  ): void {
    if (chunk.type === 'start') {
      activeRun.startChunkPublished = true
    }

    if (isChatStreamTraceEnabled()) {
      recordChatStreamTrace({
        chatSessionId: activeRun.sessionId,
        runId: activeRun.runId,
        messageId: activeRun.messageId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        providerSessionId: activeRun.runtimeSession.providerSessionId,
        toolCallId: readChunkTraceToolCallId(chunk),
        phase: 'sse_emit',
        payload: {
          chunk,
          terminal,
          subscriberCount: runSubscribers.size(activeRun.runId),
        },
      })
    }

    if (!terminal) {
      projectFinalMessageChunk(activeRun, chunk)
    }
    bufferReplayChunk(activeRun, chunk)

    runSubscribers.publish(activeRun.runId, chunk, terminal)
  }

  function bufferReplayChunk(activeRun: ActiveRun, chunk: UIMessageChunk): void {
    const coalesced = coalesceReplayChunk(activeRun, chunk)
    if (!coalesced) {
      activeRun.chunkBuffer.push(chunk)
    }
    enforceChunkBufferCap(activeRun)
  }

  /**
   * Evict from the front once the replay buffer exceeds its cap. Only
   * increments `chunkBufferDroppedCount` (a base offset) instead of
   * rewriting every stored coalesce-key index — `logicalToPhysicalIndex`
   * lazily resolves stale (already-evicted) indices as "not found" the next
   * time that key is looked up.
   */
  function enforceChunkBufferCap(activeRun: ActiveRun): void {
    const cap = readPositiveIntegerEnv('CRADLE_CHAT_RUN_REPLAY_CHUNKS', DEFAULT_RUN_REPLAY_CHUNKS)
    while (activeRun.chunkBuffer.length > cap) {
      activeRun.chunkBuffer.shift()
      activeRun.chunkBufferDroppedCount += 1
    }
  }

  function logicalToPhysicalIndex(activeRun: ActiveRun, logicalIndex: number): number {
    return logicalIndex - activeRun.chunkBufferDroppedCount
  }

  function currentTailLogicalIndex(activeRun: ActiveRun): number {
    return activeRun.chunkBuffer.length + activeRun.chunkBufferDroppedCount
  }

  /**
   * Whether a coalesced update to `chunk`'s slot should move to the tail of
   * the buffer instead of staying at its original position. Deltas
   * (text/reasoning/tool-input) represent one span growing in place, so
   * their original position (where the span started) stays correct as they
   * accumulate. `tool-output-available` is different: a `preliminary` push
   * followed by the final push are genuinely separate points in time, often
   * with unrelated text/reasoning chunks emitted in between — pinning the
   * final output to the *first* preliminary's position would replay it
   * before content that actually preceded it live.
   */
  function shouldMoveToTailOnCoalesce(chunk: UIMessageChunk): boolean {
    return chunk.type === 'tool-output-available'
  }

  function coalesceReplayChunk(activeRun: ActiveRun, chunk: UIMessageChunk): boolean {
    const key = readReplayCoalesceKey(chunk)
    if (!key) {
      return false
    }

    const existingLogicalIndex = activeRun.chunkBufferIndexByKey.get(key)
    const physicalIndex
      = existingLogicalIndex === undefined
        ? -1
        : logicalToPhysicalIndex(activeRun, existingLogicalIndex)
    const existing
      = physicalIndex >= 0 && physicalIndex < activeRun.chunkBuffer.length
        ? activeRun.chunkBuffer[physicalIndex]
        : undefined
    if (existing === undefined) {
      // No live slot to coalesce into (first occurrence, or the previous
      // slot already fell off the front of the capped buffer): reserve the
      // position this chunk is about to be pushed to.
      activeRun.chunkBufferIndexByKey.set(key, currentTailLogicalIndex(activeRun))
      return false
    }

    const merged = mergeBufferedStreamChunk(
      existing,
      chunk,
      readPositiveIntegerEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS', DEFAULT_RUN_DELTA_FLUSH_CHARS),
    )
    if (!merged) {
      activeRun.chunkBufferIndexByKey.set(key, currentTailLogicalIndex(activeRun))
      return false
    }

    if (shouldMoveToTailOnCoalesce(chunk)) {
      activeRun.chunkBuffer.splice(physicalIndex, 1)
      reindexCoalesceKeysAfterRemoval(activeRun, physicalIndex)
      activeRun.chunkBufferIndexByKey.set(key, currentTailLogicalIndex(activeRun))
      activeRun.chunkBuffer.push(merged)
    }
 else {
      activeRun.chunkBuffer[physicalIndex] = merged
    }
    return true
  }

  /** After physically removing a slot, every stored index past it shifts down by one. */
  function reindexCoalesceKeysAfterRemoval(activeRun: ActiveRun, removedPhysicalIndex: number): void {
    for (const [key, logicalIndex] of activeRun.chunkBufferIndexByKey) {
      const physicalIndex = logicalToPhysicalIndex(activeRun, logicalIndex)
      if (physicalIndex > removedPhysicalIndex) {
        activeRun.chunkBufferIndexByKey.set(key, logicalIndex - 1)
      }
    }
  }

  function publishRunStartChunk(activeRun: ActiveRun): void {
    if (activeRun.startChunkPublished) {
      return
    }
    flushPendingRunDelta(activeRun)
    publishUIMessageChunk(activeRun, { type: 'start', messageId: activeRun.messageId }, false)
  }

  return {
    snapshotActiveRun,
    startSnapshotTimer,
    stopSnapshotTimer,
    stopPendingRunDeltaFlush,
    flushAllActiveRunSnapshots,
    publishRuntimeChunk,
    flushPendingRunDelta,
    publishUIMessageChunk,
    publishRunStartChunk,
  }
}
