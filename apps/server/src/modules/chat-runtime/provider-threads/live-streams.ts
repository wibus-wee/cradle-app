import type { UIMessageChunk } from 'ai'

import { readPositiveIntegerEnv } from '../../../helpers/env'
import type { ProviderThreadEvent } from '../runtime-provider-types'
import type { SubscriberRegistry } from '../stream/subscriber-registry'
import { createSubscriberRegistry } from '../stream/subscriber-registry'

const DEFAULT_PROVIDER_THREAD_REPLAY_CHUNKS = 1_000
/** How long a terminal stream's replay buffer is kept around for late reconnects before eviction. */
const DEFAULT_PROVIDER_THREAD_STREAM_TTL_MS = 10 * 60 * 1000
/** Minimum spacing between opportunistic sweeps, so a busy store doesn't scan on every publish. */
const PROVIDER_THREAD_STREAM_PRUNE_INTERVAL_MS = 60 * 1000

interface ProviderThreadStreamState {
  sessionId: string
  threadId: string
  startedTurnIds: Set<string>
  chunks: UIMessageChunk[]
  terminal: boolean
  /** Set once `terminal` flips true; drives TTL-based eviction from `store.streams`. */
  terminalAt: number | null
}

export interface ProviderThreadStreamStore {
  streams: Map<string, ProviderThreadStreamState>
  subscribers: SubscriberRegistry
  /** Wall-clock time of the last eviction sweep, gating how often `pruneExpiredProviderThreadStreams` does work. */
  lastPrunedAt: number
}

export function createProviderThreadStreamStore(): ProviderThreadStreamStore {
  return {
    streams: new Map(),
    subscribers: createSubscriberRegistry(),
    lastPrunedAt: 0,
  }
}

/**
 * Evict terminal provider-thread streams whose grace period has elapsed.
 * Without this, `store.streams` grows without bound for the lifetime of the
 * process: every `(sessionId, threadId)` pair ever seen keeps its replay
 * buffer (up to `providerThreadReplayChunkLimit()` chunks) and its
 * `startedTurnIds` set forever, since nothing else ever deletes the entry.
 * Only terminal streams are eligible — a stream that's still receiving
 * chunks must never be evicted out from under a reconnecting subscriber.
 * Called opportunistically from the publish hot path, gated by
 * `PROVIDER_THREAD_STREAM_PRUNE_INTERVAL_MS` so it stays cheap.
 */
function pruneExpiredProviderThreadStreams(store: ProviderThreadStreamStore): void {
  const now = Date.now()
  if (now - store.lastPrunedAt < PROVIDER_THREAD_STREAM_PRUNE_INTERVAL_MS) {
    return
  }
  store.lastPrunedAt = now

  const ttlMs = readPositiveIntegerEnv(
    'CRADLE_CHAT_PROVIDER_THREAD_STREAM_TTL_MS',
    DEFAULT_PROVIDER_THREAD_STREAM_TTL_MS,
  )
  for (const [key, state] of store.streams) {
    if (state.terminal && state.terminalAt !== null && now - state.terminalAt > ttlMs) {
      store.streams.delete(key)
    }
  }
}

export function publishProviderThreadEvent(input: {
  store: ProviderThreadStreamStore
  sessionId: string
  event: ProviderThreadEvent
  isTerminalChunk: (chunk: UIMessageChunk) => boolean
}): void {
  if (input.event.providerTurnId) {
    publishProviderThreadChunk({
      store: input.store,
      sessionId: input.sessionId,
      threadId: input.event.providerThreadId,
      chunk: {
        type: 'start',
        messageId: providerThreadAssistantMessageId(
          input.event.providerThreadId,
          input.event.providerTurnId,
          0,
        ),
      },
      terminal: false,
      providerTurnId: input.event.providerTurnId,
    })
  }
  for (const chunk of input.event.chunks) {
    publishProviderThreadChunk({
      store: input.store,
      sessionId: input.sessionId,
      threadId: input.event.providerThreadId,
      chunk,
      terminal: input.isTerminalChunk(chunk),
      providerTurnId: input.event.providerTurnId,
    })
  }
}

export function publishProviderThreadChunk(input: {
  store: ProviderThreadStreamStore
  sessionId: string
  threadId: string
  chunk: UIMessageChunk
  terminal: boolean
  providerTurnId: string | null
}): void {
  pruneExpiredProviderThreadStreams(input.store)

  const key = providerThreadStreamKey(input.sessionId, input.threadId)
  const state = input.store.streams.get(key) ?? {
    sessionId: input.sessionId,
    threadId: input.threadId,
    startedTurnIds: new Set<string>(),
    chunks: [],
    terminal: false,
    terminalAt: null,
  }
  input.store.streams.set(key, state)

  if (input.chunk.type === 'start' && input.providerTurnId) {
    if (state.startedTurnIds.has(input.providerTurnId)) {
      return
    }
    state.startedTurnIds.add(input.providerTurnId)
  }

  if (!state.terminal) {
    state.chunks.push(input.chunk)
    while (state.chunks.length > providerThreadReplayChunkLimit()) {
      state.chunks.shift()
    }
  }
  if (input.terminal && !state.terminal) {
    state.terminal = true
    state.terminalAt = Date.now()
  }

  input.store.subscribers.publish(key, input.chunk, input.terminal)
}

export function providerThreadStreamKey(sessionId: string, threadId: string): string {
  return `${sessionId}:${threadId}`
}

function providerThreadAssistantMessageId(
  threadId: string,
  turnId: string,
  assistantMessageIndex: number,
): string {
  return `provider-thread:${threadId}:turn:${turnId}:assistant:${assistantMessageIndex}`
}

function providerThreadReplayChunkLimit(): number {
  return readPositiveIntegerEnv(
    'CRADLE_CHAT_PROVIDER_THREAD_REPLAY_CHUNKS',
    DEFAULT_PROVIDER_THREAD_REPLAY_CHUNKS,
  )
}
