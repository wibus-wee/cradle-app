import type { NewRunStreamCheckpoint, RunStreamCheckpoint } from '@cradle/db'
import { runStreamCheckpoints } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../../infra'
import type { ChatRuntimeWriteDb } from '../es/event-store'

type CheckpointDb = Pick<ChatRuntimeWriteDb, 'select' | 'insert' | 'delete'>

/**
 * Ephemeral streaming checkpoint store. Plain state writes — not session-actor /
 * event-transaction machinery. Upserted on the ~10s snapshot timer; deleted on
 * terminal commit or session delete; promoted to AssistantMessageCompleted on crash recovery.
 */
export function upsertRunStreamCheckpoint(
  input: NewRunStreamCheckpoint,
  d: CheckpointDb = db(),
): void {
  d.insert(runStreamCheckpoints)
    .values(input)
    .onConflictDoUpdate({
      target: runStreamCheckpoints.runId,
      set: {
        sessionId: input.sessionId,
        messageId: input.messageId,
        messageJson: input.messageJson,
        chunkSeq: input.chunkSeq,
        updatedAt: input.updatedAt,
      },
    })
    .run()
}

export function readRunStreamCheckpoint(
  runId: string,
  d: Pick<CheckpointDb, 'select'> = db(),
): RunStreamCheckpoint | undefined {
  return d
    .select()
    .from(runStreamCheckpoints)
    .where(eq(runStreamCheckpoints.runId, runId))
    .get()
}

export function readRunStreamCheckpointsBySession(
  sessionId: string,
  d: Pick<CheckpointDb, 'select'> = db(),
): RunStreamCheckpoint[] {
  return d
    .select()
    .from(runStreamCheckpoints)
    .where(eq(runStreamCheckpoints.sessionId, sessionId))
    .all()
}

export function deleteRunStreamCheckpoint(
  runId: string,
  d: Pick<CheckpointDb, 'delete'> = db(),
): void {
  d.delete(runStreamCheckpoints).where(eq(runStreamCheckpoints.runId, runId)).run()
}

export function deleteRunStreamCheckpointsBySession(
  sessionId: string,
  d: Pick<CheckpointDb, 'delete'> = db(),
): void {
  d.delete(runStreamCheckpoints).where(eq(runStreamCheckpoints.sessionId, sessionId)).run()
}
