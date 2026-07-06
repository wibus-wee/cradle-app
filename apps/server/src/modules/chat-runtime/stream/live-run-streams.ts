import { backendRuns } from '@cradle/db'
import type { UIMessageChunk } from 'ai'
import { eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { readPositiveIntegerEnv } from '../../../helpers/env'
import { db } from '../../../infra'
import {
  createProviderThreadStreamStore,
  providerThreadStreamKey,
} from '../provider-threads/live-streams'
import { runRegistry } from '../run-registry'
import { DEFAULT_RUN_DELTA_FLUSH_CHARS, DEFAULT_RUN_WAIT_TIMEOUT_MS } from './constants'
import { openBufferedChunkStream } from './sse'
import type { ChunkSubscriber } from './subscriber-registry'
import { createSubscriberRegistry } from './subscriber-registry'

export const runSubscribers = createSubscriberRegistry()
export const providerThreadStreamStore = createProviderThreadStreamStore()

/**
 * Chunk emitted in place of a real replay/terminal event when the DB row
 * still says `streaming` but no in-memory `ActiveRun` exists for it (the
 * server process that was running it exited or restarted mid-stream, before
 * the boot-time recovery sweep — see `es/recovery.ts` — reconciled its
 * status). Without this, `openBufferedChunkStream` would enqueue zero
 * chunks and close immediately, which is indistinguishable on the wire from
 * "this run legitimately finished with no output".
 */
function createRunInterruptedChunk(): UIMessageChunk {
  return {
    type: 'error',
    errorText: 'This run was interrupted before it finished streaming (the server may have restarted).',
  }
}

export function openRunEventStream(runId: string): ReadableStream<Uint8Array> {
  const run = readRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId },
    })
  }
  const active = runRegistry.getActiveRun(runId)
  const orphanedWhileStreaming = run.status === 'streaming' && !active
  return openBufferedChunkStream({
    replayChunks: orphanedWhileStreaming
      ? [createRunInterruptedChunk()]
      : active?.chunkBuffer ?? [],
    terminal: run.status !== 'streaming' || !active,
    coalesceMaxChars: readPositiveIntegerEnv(
      'CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS',
      DEFAULT_RUN_DELTA_FLUSH_CHARS,
    ),
    subscribe: (subscriber: ChunkSubscriber) => runSubscribers.subscribe(runId, subscriber),
  })
}

export function openProviderThreadStream(
  sessionId: string,
  providerThreadId: string,
): ReadableStream<Uint8Array> {
  const key = providerThreadStreamKey(sessionId, providerThreadId)
  const state = providerThreadStreamStore.streams.get(key)
  return openBufferedChunkStream({
    replayChunks: state?.chunks ?? [],
    terminal: state?.terminal,
    coalesceMaxChars: readPositiveIntegerEnv(
      'CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS',
      DEFAULT_RUN_DELTA_FLUSH_CHARS,
    ),
    subscribe: (subscriber: ChunkSubscriber) =>
      providerThreadStreamStore.subscribers.subscribe(key, subscriber),
  })
}

export function waitForRunCompletion(runId: string): Promise<typeof backendRuns.$inferSelect> {
  const run = readRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId },
    })
  }
  if (run.status !== 'streaming') {
    return Promise.resolve(run)
  }

  const timeoutMs = readPositiveIntegerEnv(
    'CRADLE_CHAT_RUN_WAIT_TIMEOUT_MS',
    DEFAULT_RUN_WAIT_TIMEOUT_MS,
  )

  return new Promise((resolve, reject) => {
    let settled = false

    // Belt-and-suspenders against a terminal event that never arrives (e.g.
    // shutdown clears the active-run registry without publishing a terminal
    // chunk to subscribers, see `runRegistry.clearAll()`): without this,
    // every caller awaiting this run — automations, issue-agent, diff
    // review, conversation bridge — would hang indefinitely.
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      unsubscribe()
      reject(new AppError({
        code: 'chat_run_wait_timeout',
        status: 504,
        message: `Timed out after ${timeoutMs}ms waiting for chat run ${runId} to complete.`,
        details: { runId, timeoutMs },
      }))
    }, timeoutMs)

    const unsubscribe = runSubscribers.subscribe(runId, (_event, terminal) => {
      if (!terminal || settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(readRun(runId) ?? run)
    })

    const latest = readRun(runId)
    if (latest && latest.status !== 'streaming' && !settled) {
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(latest)
    }
  })
}

function readRun(runId: string): typeof backendRuns.$inferSelect | undefined {
  return db().select().from(backendRuns).where(eq(backendRuns.id, runId)).get()
}
