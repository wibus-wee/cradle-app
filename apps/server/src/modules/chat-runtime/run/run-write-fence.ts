import { backendRuns } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../../infra'
import type { TerminalChatMessageStatus } from './stream-chunks'

/**
 * Terminal-state fence for any writer that mutates Chat Runtime read models
 * while a run may be streaming.
 *
 * The source of truth is the persisted {@link backendRuns} row, never in-memory
 * active-run state. Late writers (snapshot timers, finalizers, delta flushes)
 * call this before writing and stop if the run is already terminal or missing,
 * so a stale active run cannot reverse a terminal fact.
 */
export type RunWriteFence
  = | { status: 'streaming' }
    | { status: TerminalChatMessageStatus, errorText: string | null }
    | { status: 'missing' }

export function readRunWriteFence(runId: string): RunWriteFence {
  const run = db().select().from(backendRuns).where(eq(backendRuns.id, runId)).get()
  if (!run) {
    return { status: 'missing' }
  }
  if (run.status === 'streaming') {
    return { status: 'streaming' }
  }
  return { status: run.status, errorText: run.errorText }
}
