import { messages, sessions } from '@cradle/db'
import type { UIMessageChunk } from 'ai'
import { and, eq } from 'drizzle-orm'

import { readPositiveIntegerEnv } from '../../../helpers/env'
import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import { compactStoredMessageSnapshot } from '../message-snapshot-compaction'
import {
  flushFinalMessageProjection,
  projectFinalMessageChunk
} from '../run/final-message-projection'
import { readRunWriteFence, type RunWriteFence } from '../run/run-write-fence'
import {
  mergeBufferedStreamChunk,
  mergeRuntimeDeltaChunk,
  readDeltaChunkTextLength,
  readReplayCoalesceKey,
  readRunDeltaCoalesceKey
} from '../run/stream-chunks'
import { readChunkTraceToolCallId } from '../run/snapshot-events'
import { runRegistry, type ActiveRun } from '../run-registry'
import { isChatStreamTraceEnabled, recordChatStreamTrace } from '../stream-trace'
import { extractMessageText, normalizeMessageSnapshot } from '../ui-message'
import {
  DEFAULT_RUN_DELTA_FLUSH_CHARS,
  DEFAULT_RUN_DELTA_FLUSH_MS,
  DEFAULT_SNAPSHOT_INTERVAL_MS
} from './constants'
import { runSubscribers } from './live-run-streams'

export interface ActiveRunStreamControllerDeps {
  releaseStaleActiveRun(activeRun: ActiveRun, fence: RunWriteFence): void
}

export interface ActiveRunStreamController {
  snapshotActiveRun(activeRun: ActiveRun): void
  startSnapshotTimer(activeRun: ActiveRun): void
  stopSnapshotTimer(activeRun: ActiveRun): void
  stopPendingRunDeltaFlush(activeRun: ActiveRun): void
  flushAllActiveRunSnapshots(): void
  publishRuntimeChunk(activeRun: ActiveRun, chunk: UIMessageChunk): void
  flushPendingRunDelta(activeRun: ActiveRun): void
  publishUIMessageChunk(activeRun: ActiveRun, chunk: UIMessageChunk, terminal: boolean): void
  publishRunStartChunk(activeRun: ActiveRun): void
}

export function createActiveRunStreamController(
  deps: ActiveRunStreamControllerDeps
): ActiveRunStreamController {
  function snapshotActiveRun(activeRun: ActiveRun): void {
    if (activeRun.terminalStatus) {
      return
    }
    flushFinalMessageProjection(activeRun)
    persistStreamingMessageSnapshot(activeRun)
  }

  // Fenced streaming message writer. The only path that writes `messages` with
  // `status = 'streaming'`. It checks the persisted run row first: once a
  // terminal fact exists the run row is terminal, the fence returns
  // non-streaming, and this releases the stale active run instead of
  // overwriting a terminal message. `persistMessageSnapshot()` stays fence-free
  // with no run id; it serves only the event-derived terminal projection and
  // non-streaming record mutations.
  function persistStreamingMessageSnapshot(activeRun: ActiveRun): void {
    const fence = readRunWriteFence(activeRun.runId)
    if (fence.status === 'streaming') {
      const message = compactStoredMessageSnapshot(normalizeMessageSnapshot(activeRun.finalMessage))
      const messageJson = JSON.stringify(message)
      db().transaction((tx) => {
        tx.update(messages)
          .set({
            content: extractMessageText(message),
            messageJson,
            status: 'streaming',
            errorText: null,
            updatedAt: currentUnixSeconds()
          })
          .where(
            and(eq(messages.id, activeRun.messageId), eq(messages.sessionId, activeRun.sessionId))
          )
          .run()

        tx.update(sessions)
          .set({ updatedAt: currentUnixSeconds() })
          .where(eq(sessions.id, activeRun.sessionId))
          .run()
      })
      return
    }

    // Run is already terminal or gone: a stale active run continued after
    // recovery. Stop writing and release it. The persisted terminal fact wins.
    deps.releaseStaleActiveRun(activeRun, fence)
  }

  function startSnapshotTimer(activeRun: ActiveRun): void {
    stopSnapshotTimer(activeRun)
    activeRun.snapshotTimer = setInterval(
      snapshotActiveRun,
      readPositiveIntegerEnv('CRADLE_CHAT_SNAPSHOT_INTERVAL_MS', DEFAULT_SNAPSHOT_INTERVAL_MS),
      activeRun
    )
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

  function flushAllActiveRunSnapshots(): void {
    for (const activeRun of runRegistry.listActiveRuns()) {
      try {
        snapshotActiveRun(activeRun)
      } catch {
        // best-effort on shutdown
      }
    }
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
        readDeltaChunkTextLength(merged) >=
        readPositiveIntegerEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS', DEFAULT_RUN_DELTA_FLUSH_CHARS)
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
      readPositiveIntegerEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_MS', DEFAULT_RUN_DELTA_FLUSH_MS)
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
    terminal: boolean
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
          subscriberCount: runSubscribers.size(activeRun.runId)
        }
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
    if (coalesced) {
      return
    }

    activeRun.chunkBuffer.push(chunk)
  }

  function coalesceReplayChunk(activeRun: ActiveRun, chunk: UIMessageChunk): boolean {
    const key = readReplayCoalesceKey(chunk)
    if (!key) {
      return false
    }

    const existingIndex = activeRun.chunkBufferIndexByKey.get(key)
    if (existingIndex === undefined) {
      activeRun.chunkBufferIndexByKey.set(key, activeRun.chunkBuffer.length)
      return false
    }

    const existing = activeRun.chunkBuffer[existingIndex]
    const merged = mergeBufferedStreamChunk(
      existing,
      chunk,
      readPositiveIntegerEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS', DEFAULT_RUN_DELTA_FLUSH_CHARS)
    )
    if (!merged) {
      activeRun.chunkBufferIndexByKey.set(key, activeRun.chunkBuffer.length)
      return false
    }
    activeRun.chunkBuffer[existingIndex] = merged
    return true
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
    publishRunStartChunk
  }
}
