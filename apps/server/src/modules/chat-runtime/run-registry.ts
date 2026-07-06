import type { UIMessage, UIMessageChunk } from 'ai'

import type { FinalMessageProjectionState } from './run/final-message-projection'
import type { ChatMessageStatus } from './run/stream-chunks'
import type { ChatRuntime, ChatRuntimeSettings, RuntimeSession } from './runtime-provider-types'

export type TerminalChatMessageStatus = Exclude<ChatMessageStatus, 'streaming'>

export interface SnapshotCoalesceEntry {
  eventId: string
  coalescedCount: number
}

export interface ActiveRun {
  runId: string
  sessionId: string
  messageId: string
  providerTargetKind: 'manual' | 'external' | null
  providerTargetId: string | null
  runtime: ChatRuntime
  runtimeSession: RuntimeSession
  modelId: string | null
  chunkBuffer: UIMessageChunk[]
  /**
   * Coalesce key -> *logical* index into `chunkBuffer` (i.e. offset by
   * `chunkBufferDroppedCount`, not a direct array index). Logical indexing
   * lets old chunks be evicted from the front of `chunkBuffer` (see
   * `chunkBufferDroppedCount`) without having to rewrite every stored index
   * on each eviction.
   */
  chunkBufferIndexByKey: Map<string, number>
  /** Number of chunks ever evicted from the front of `chunkBuffer` once it exceeded its cap. */
  chunkBufferDroppedCount: number
  pendingDeltaChunk: UIMessageChunk | null
  pendingDeltaFlushTimer: ReturnType<typeof setTimeout> | null
  snapshotTimer: ReturnType<typeof setInterval> | null
  finalMessage: UIMessage
  finalProjection: FinalMessageProjectionState
  startChunkPublished?: boolean
  firstTokenDeltaSnapshotRecorded?: boolean
  firstTextDeltaSnapshotRecorded?: boolean
  lastStreamingSnapshotMessageJson?: string | null
  pendingStreamingSnapshotMessageJson?: string | null
  terminalStatus?: TerminalChatMessageStatus
  cancelRequested?: boolean
  queueItemId?: string
  runtimeSettings: ChatRuntimeSettings
  internalContinuation?: 'runtimeGoal'
  runSnapshotId?: string | null
  runSnapshotSeq: number
  /**
   * Coalesce key (mirrors {@link readReplayCoalesceKey}) -> durable snapshot
   * event id + how many times it has been coalesced. Lets repeated chunks for
   * the same logical event (e.g. a tool output pushed thousands of times by a
   * misbehaving provider) update one row instead of appending a new row per push.
   */
  snapshotEventIdByCoalesceKey: Map<string, SnapshotCoalesceEntry>
  /** Id of the single `snapshot_events_truncated` marker row for this run, once the event cap is hit. */
  runSnapshotTruncatedEventId?: string | null
  /** Count of events dropped after the per-run snapshot event cap was hit. */
  runSnapshotDroppedEventCount: number
}

/**
 * Per-session in-flight run state. Owned by the run registry so that concern
 * modules can access active/pending run state through a handle instead of
 * closing over service.ts module globals.
 */
export interface PendingRunState {
  cancelled: boolean
  queueItemId?: string
}

/**
 * The active-run registry owns the three module-level maps that track
 * in-flight chat runs:
 *  - activeRuns: runId → ActiveRun
 *  - activeRunIdsBySession: sessionId → runId (single-flight index)
 *  - pendingRunSessions: sessionId → PendingRunState (runs being set up)
 *
 * Encapsulating them behind methods (rather than raw Maps) gives a single
 * ownership boundary, makes the access surface explicit, and lets extracted
 * concern modules consume run state via the imported `runRegistry` handle.
 */
class RunRegistry {
  private readonly activeRuns = new Map<string, ActiveRun>()
  private readonly activeRunIdsBySession = new Map<string, string>()
  private readonly pendingRunSessions = new Map<string, PendingRunState>()

  // ── active runs ──
  getActiveRun(runId: string): ActiveRun | undefined {
    return this.activeRuns.get(runId)
  }
  setActiveRun(runId: string, run: ActiveRun): void {
    this.activeRuns.set(runId, run)
  }
  deleteActiveRun(runId: string): void {
    this.activeRuns.delete(runId)
  }
  hasActiveRun(runId: string): boolean {
    return this.activeRuns.has(runId)
  }
  listActiveRuns(): ActiveRun[] {
    return Array.from(this.activeRuns.values())
  }
  listActiveRunIds(): string[] {
    return Array.from(this.activeRuns.keys())
  }

  /**
   * Clear all in-flight run state (abortAllRuns / shutdown). Clears all three
   * maps atomically since activeRuns + activeRunIdsBySession + pendingRunSessions
   * are always cleared together.
   */
  clearAll(): void {
    this.activeRuns.clear()
    this.activeRunIdsBySession.clear()
    this.pendingRunSessions.clear()
  }

  // ── session → active run (single-flight index) ──
  getActiveRunIdForSession(sessionId: string): string | undefined {
    return this.activeRunIdsBySession.get(sessionId)
  }
  setActiveRunIdForSession(sessionId: string, runId: string): void {
    this.activeRunIdsBySession.set(sessionId, runId)
  }
  deleteActiveRunIdForSession(sessionId: string): void {
    this.activeRunIdsBySession.delete(sessionId)
  }
  hasActiveRunForSession(sessionId: string): boolean {
    return this.activeRunIdsBySession.has(sessionId)
  }

  // ── pending runs (being set up, before the pump starts) ──
  getPendingRun(sessionId: string): PendingRunState | undefined {
    return this.pendingRunSessions.get(sessionId)
  }
  setPendingRun(sessionId: string, state: PendingRunState): void {
    this.pendingRunSessions.set(sessionId, state)
  }
  deletePendingRun(sessionId: string): void {
    this.pendingRunSessions.delete(sessionId)
  }
  hasPendingRun(sessionId: string): boolean {
    return this.pendingRunSessions.has(sessionId)
  }
}

export const runRegistry = new RunRegistry()
