import type { UIMessage } from 'ai'

import type { RuntimeSession, RuntimeSettings } from './runtime-provider-types'

export interface LiveRuntimeNativeFollowUpInput {
  queueItemId: string
  message: UIMessage
}

export interface LiveRuntimeSessionRecord {
  sessionId: string
  runtimeKind: string
  providerTargetId: string | null
  readRuntimeSession: () => RuntimeSession
  updateRuntimeSettings: (settings: RuntimeSettings) => Promise<void>
  /**
   * When a long-lived provider query is alive during an active Cradle run, enqueue the
   * follow-up into the provider-native message queue (append, no interrupt). Throws if the
   * live query cannot accept input — callers must not treat the Cradle queue row as delivered.
   */
  enqueueNativeFollowUp?: (input: LiveRuntimeNativeFollowUpInput) => Promise<void>
  /**
   * Cancel a previously native-enqueued follow-up that has not been adopted by a Cradle run yet.
   * Returns true when the provider dropped it from its pending adopt list.
   */
  cancelNativeFollowUp?: (queueItemId: string) => Promise<boolean>
  /**
   * Claim a native follow-up for the next Cradle `streamTurn` so the provider adopts without
   * pushing the same content a second time. Returns true when the item was pending natively.
   */
  claimNativeFollowUp?: (queueItemId: string) => boolean
}

class LiveRuntimeSessionRegistry {
  private readonly records = new Map<string, LiveRuntimeSessionRecord>()
  /**
   * Session-scoped queue item ids whose native follow-ups were absorbed into a live
   * provider turn (Claude mid-turn `queued_command`). Survives live-query teardown so
   * drain can complete without an empty second run after the provider releases its
   * in-memory follow-up map.
   */
  private readonly midTurnAbsorbedNativeFollowUps = new Map<string, Set<string>>()

  /**
   * Register mutable provider state that outlives a Chat Runtime run. This is
   * deliberately separate from durable provider bindings: registration proves a
   * live provider object can accept controls without starting or resuming one.
   */
  register(record: LiveRuntimeSessionRecord): () => void {
    this.records.set(record.sessionId, record)
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      if (this.records.get(record.sessionId) === record) {
        this.records.delete(record.sessionId)
      }
    }
  }

  read(sessionId: string): LiveRuntimeSessionRecord | undefined {
    return this.records.get(sessionId)
  }

  markNativeFollowUpAbsorbedMidTurn(sessionId: string, queueItemId: string): void {
    let set = this.midTurnAbsorbedNativeFollowUps.get(sessionId)
    if (!set) {
      set = new Set()
      this.midTurnAbsorbedNativeFollowUps.set(sessionId, set)
    }
    set.add(queueItemId)
  }

  isNativeFollowUpAbsorbedMidTurn(sessionId: string, queueItemId: string): boolean {
    return Boolean(this.midTurnAbsorbedNativeFollowUps.get(sessionId)?.has(queueItemId))
  }

  /**
   * Consume a mid-turn-absorbed follow-up so drain / adopt no longer treat it as pending.
   * Returns true when the item was absorbed and removed.
   */
  consumeNativeFollowUpAbsorbedMidTurn(sessionId: string, queueItemId: string): boolean {
    const set = this.midTurnAbsorbedNativeFollowUps.get(sessionId)
    if (!set?.has(queueItemId)) {
      return false
    }
    set.delete(queueItemId)
    if (set.size === 0) {
      this.midTurnAbsorbedNativeFollowUps.delete(sessionId)
    }
    return true
  }

  clearNativeFollowUpAbsorbedMidTurn(sessionId: string, queueItemId: string): void {
    const set = this.midTurnAbsorbedNativeFollowUps.get(sessionId)
    if (!set) {
      return
    }
    set.delete(queueItemId)
    if (set.size === 0) {
      this.midTurnAbsorbedNativeFollowUps.delete(sessionId)
    }
  }

  clear(): void {
    this.records.clear()
    this.midTurnAbsorbedNativeFollowUps.clear()
  }
}

export const liveRuntimeSessionRegistry = new LiveRuntimeSessionRegistry()
