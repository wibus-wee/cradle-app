import type { RuntimeSession, RuntimeSettings } from './runtime-provider-types'

export interface LiveRuntimeSessionRecord {
  sessionId: string
  runtimeKind: string
  providerTargetId: string | null
  readRuntimeSession: () => RuntimeSession
  updateRuntimeSettings: (settings: RuntimeSettings) => Promise<void>
}

class LiveRuntimeSessionRegistry {
  private readonly records = new Map<string, LiveRuntimeSessionRecord>()

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

  clear(): void {
    this.records.clear()
  }
}

export const liveRuntimeSessionRegistry = new LiveRuntimeSessionRegistry()
