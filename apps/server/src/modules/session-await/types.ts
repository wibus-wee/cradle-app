import type { sessionAwaits } from '@cradle/db'

export type SessionAwait = typeof sessionAwaits.$inferSelect

export type SessionAwaitStatus = 'pending' | 'triggered' | 'expired' | 'cancelled' | 'failed'

export interface RegisterAwaitInput {
  chatSessionId: string
  workspaceId: string
  source: string
  filterJson: string
  reason?: string | null
  expiresAt?: number | null
  fireAt?: number | null
}

export interface TriggerAwaitInput {
  awaitId: string
  resumeText: string
  resumePayloadJson?: string | null
}

export interface RetryAwaitDeliveryInput {
  awaitId: string
  resumeText?: string
  resumePayloadJson?: string | null
}

export interface SessionAwaitSummary {
  awaiting: boolean
  pendingCount: number
  primaryAwaitId: string | null
  primarySource: string | null
  reason: string | null
}

interface PendingCheckResult {
  awaitId: string
  matched: false
  transientError?: string
  permanentError?: string
  incrementErrorCount?: boolean
  /** When set, the await's filterJson is silently updated (e.g. head SHA tracking) without triggering a resume. */
  filterUpdate?: string
  /**
   * Serialized progress observation reported by a still-pending source check
   * (javascript cell `{ pending: true, progress }`). `null` clears a stale
   * observation after a clean check; `undefined` leaves the stored one alone.
   */
  observationJson?: string | null
}

interface MatchedCheckResult {
  awaitId: string
  matched: true
  resumeText: string
  resumePayloadJson?: string
}

export type CheckResult = MatchedCheckResult | PendingCheckResult

export interface SessionAwaitSource {
  source: string
  /** Defaults to inline. Queued sources are scheduled off the poller fast path. */
  execution?: 'inline' | 'queued'
  pollIntervalMs?: number
  resumeOnFailure?: boolean
  /** When set, consecutiveErrorCount is owned by this source via recordTrackedEvaluationCheck. */
  tracksConsecutiveErrors?: boolean
  checkPending: (awaits: SessionAwait[]) => Promise<CheckResult[]>
}
