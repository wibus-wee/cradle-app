import { backendRuns } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { readPositiveIntegerEnv } from '../../../helpers/env'
import { db } from '../../../infra'
import {
  createProviderThreadStreamStore,
  providerThreadStreamKey
} from '../provider-threads/live-streams'
import { runRegistry } from '../run-registry'
import type { ChunkSubscriber } from './subscriber-registry'
import { createSubscriberRegistry } from './subscriber-registry'
import { openBufferedChunkStream } from './sse'
import { DEFAULT_RUN_DELTA_FLUSH_CHARS } from './constants'

export const runSubscribers = createSubscriberRegistry()
export const providerThreadStreamStore = createProviderThreadStreamStore()

export function openRunEventStream(runId: string): ReadableStream<Uint8Array> {
  const run = readRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId }
    })
  }
  const active = runRegistry.getActiveRun(runId)
  return openBufferedChunkStream({
    replayChunks: active?.chunkBuffer ?? [],
    terminal: run.status !== 'streaming' || !active,
    coalesceMaxChars: readPositiveIntegerEnv(
      'CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS',
      DEFAULT_RUN_DELTA_FLUSH_CHARS
    ),
    subscribe: (subscriber: ChunkSubscriber) => runSubscribers.subscribe(runId, subscriber)
  })
}

export function openProviderThreadStream(
  sessionId: string,
  providerThreadId: string
): ReadableStream<Uint8Array> {
  const key = providerThreadStreamKey(sessionId, providerThreadId)
  const state = providerThreadStreamStore.streams.get(key)
  return openBufferedChunkStream({
    replayChunks: state?.chunks ?? [],
    terminal: state?.terminal,
    coalesceMaxChars: readPositiveIntegerEnv(
      'CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS',
      DEFAULT_RUN_DELTA_FLUSH_CHARS
    ),
    subscribe: (subscriber: ChunkSubscriber) =>
      providerThreadStreamStore.subscribers.subscribe(key, subscriber)
  })
}

export function waitForRunCompletion(runId: string): Promise<typeof backendRuns.$inferSelect> {
  const run = readRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId }
    })
  }
  if (run.status !== 'streaming') {
    return Promise.resolve(run)
  }

  return new Promise((resolve) => {
    const unsubscribe = runSubscribers.subscribe(runId, (_event, terminal) => {
      if (!terminal) {
        return
      }
      unsubscribe()
      resolve(readRun(runId) ?? run)
    })

    const latest = readRun(runId)
    if (latest && latest.status !== 'streaming') {
      unsubscribe()
      resolve(latest)
    }
  })
}

function readRun(runId: string): typeof backendRuns.$inferSelect | undefined {
  return db().select().from(backendRuns).where(eq(backendRuns.id, runId)).get()
}
