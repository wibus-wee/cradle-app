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
  mergeRuntimeDeltaChunk,
  readDeltaChunkTextLength,
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
  DEFAULT_SNAPSHOT_INTERVAL_MS,
} from './constants'
import { runSubscribers } from './live-run-streams'

export interface ActiveRunStreamControllerDeps {
  handleStaleActiveRun: (activeRun: ActiveRun, fence: RunWriteFence) => void
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
          deps.handleStaleActiveRun(activeRun, latestFence)
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
    deps.handleStaleActiveRun(activeRun, fence)
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
        deps.handleStaleActiveRun(activeRun, fence)
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
    activeRun.runChunkLog.append(chunk, terminal)
    runSubscribers.publish(activeRun.runId, chunk, terminal)
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
