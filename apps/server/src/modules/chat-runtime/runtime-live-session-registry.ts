import type { UUID } from 'node:crypto'

import type { UIMessage } from 'ai'

import type { RuntimeSession, RuntimeSettings } from './runtime-provider-types'

export interface LiveRuntimeNativeInput {
  queueItemId: UUID
  message: UIMessage
}

export type LiveRuntimeNativeInputOutcome = 'completed' | 'failed' | 'cancelled'

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
  submitNativeInput?: (input: LiveRuntimeNativeInput) => Promise<void>
  /**
   * Cancel a previously submitted native input by its durable queue / SDK UUID.
   * Returns true only when the native runtime confirms cancellation.
   */
  cancelNativeInput?: (queueItemId: string) => Promise<boolean>
  /** Returns true while the UUID is still owned by the live native input channel. */
  hasNativeInput?: (queueItemId: string) => boolean
}

class LiveRuntimeSessionRegistry {
  private readonly records = new Map<string, LiveRuntimeSessionRecord>()
  private readonly terminalNativeInputs = new Map<
    string,
    Map<string, LiveRuntimeNativeInputOutcome>
  >()

  private readonly nativeInputTerminalListeners = new Set<(sessionId: string) => void>()

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

  markNativeInputsTerminal(
    sessionId: string,
    outcomes: Iterable<{ queueItemId: string, outcome: LiveRuntimeNativeInputOutcome }>,
  ): void {
    let terminal = this.terminalNativeInputs.get(sessionId)
    if (!terminal) {
      terminal = new Map()
      this.terminalNativeInputs.set(sessionId, terminal)
    }
    let changed = false
    for (const { queueItemId, outcome } of outcomes) {
      terminal.set(queueItemId, outcome)
      changed = true
    }
    if (changed) {
      for (const listener of this.nativeInputTerminalListeners) {
        listener(sessionId)
      }
    }
  }

  subscribeNativeInputTerminals(listener: (sessionId: string) => void): () => void {
    this.nativeInputTerminalListeners.add(listener)
    return () => this.nativeInputTerminalListeners.delete(listener)
  }

  readTerminalNativeInput(
    sessionId: string,
    queueItemId: string,
  ): LiveRuntimeNativeInputOutcome | undefined {
    return this.terminalNativeInputs.get(sessionId)?.get(queueItemId)
  }

  consumeTerminalNativeInput(
    sessionId: string,
    queueItemId: string,
  ): LiveRuntimeNativeInputOutcome | undefined {
    const terminal = this.terminalNativeInputs.get(sessionId)
    if (!terminal) {
      return undefined
    }
    const outcome = terminal.get(queueItemId)
    if (!outcome) {
      return undefined
    }
    terminal.delete(queueItemId)
    if (terminal.size === 0) {
      this.terminalNativeInputs.delete(sessionId)
    }
    return outcome
  }

  discardTerminalNativeInput(sessionId: string, queueItemId: string): void {
    const terminal = this.terminalNativeInputs.get(sessionId)
    if (!terminal) {
      return
    }
    terminal.delete(queueItemId)
    if (terminal.size === 0) {
      this.terminalNativeInputs.delete(sessionId)
    }
  }

  clear(): void {
    this.records.clear()
    this.terminalNativeInputs.clear()
  }
}

export const liveRuntimeSessionRegistry = new LiveRuntimeSessionRegistry()
