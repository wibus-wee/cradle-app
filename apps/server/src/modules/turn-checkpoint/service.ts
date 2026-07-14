import { randomUUID } from 'node:crypto'

import { turnCheckpoints } from '@cradle/db'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import {
  captureCheckpoint,
  deleteCheckpointRefs,
  isGitWorkspace,
  restoreCheckpoint,
  summarizeCheckpointDiff,
} from './git-store'

const CHECKPOINT_PREFIX = 'refs/cradle/checkpoints'
const checkpointInsertOrder = sql`turn_checkpoints.rowid`

function refToken(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function checkpointRefs(sessionId: string, runId: string) {
  const family = `${CHECKPOINT_PREFIX}/${refToken(sessionId)}/${refToken(runId)}`
  return { startRef: `${family}/start`, endRef: `${family}/end` }
}

export type TurnCheckpointView = typeof turnCheckpoints.$inferSelect

export interface HistoricalRewindPlan {
  checkpoint: TurnCheckpointView
  rollbackTurns: number
  subsequentCheckpoints: TurnCheckpointView[]
}

export async function captureRunStart(input: {
  sessionId: string
  runId: string
  assistantMessageId: string | null
  workspaceId: string | null
  workspacePath: string | null
}): Promise<TurnCheckpointView | null> {
  if (!input.workspacePath || !(await isGitWorkspace(input.workspacePath))) {
    return null
  }
  const existing = db().select().from(turnCheckpoints).where(and(
    eq(turnCheckpoints.sessionId, input.sessionId),
    eq(turnCheckpoints.runId, input.runId),
  )).get()
  if (existing?.status === 'completed' || existing?.status === 'capturing') {
    return existing
  }

  const now = currentUnixSeconds()
  const refs = checkpointRefs(input.sessionId, input.runId)
  const id = existing?.id ?? randomUUID()
  db().insert(turnCheckpoints).values({
    id,
    sessionId: input.sessionId,
    runId: input.runId,
    assistantMessageId: input.assistantMessageId,
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    ...refs,
    status: 'capturing',
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [turnCheckpoints.sessionId, turnCheckpoints.runId],
    set: {
      assistantMessageId: input.assistantMessageId,
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      startRef: refs.startRef,
      endRef: null,
      status: 'capturing',
      errorText: null,
      updatedAt: now,
    },
  }).run()

  try {
    await captureCheckpoint(input.workspacePath, refs.startRef)
    return requireCheckpoint(id)
  }
  catch (error) {
    markFailed(id, error)
    throw error
  }
}

export async function captureRunEnd(input: {
  sessionId: string
  runId: string
}): Promise<TurnCheckpointView | null> {
  const row = db().select().from(turnCheckpoints).where(and(
    eq(turnCheckpoints.sessionId, input.sessionId),
    eq(turnCheckpoints.runId, input.runId),
  )).get()
  if (!row) {
    return null
  }
  if (row.status === 'completed') {
    return row
  }
  const { endRef } = checkpointRefs(input.sessionId, input.runId)
  try {
    await captureCheckpoint(row.workspacePath, endRef)
    const summary = await summarizeCheckpointDiff(row.workspacePath, row.startRef, endRef)
    const now = currentUnixSeconds()
    db().update(turnCheckpoints).set({
      endRef,
      status: 'completed',
      ...summary,
      completedAt: now,
      errorText: null,
      updatedAt: now,
    }).where(eq(turnCheckpoints.id, row.id)).run()
    return requireCheckpoint(row.id)
  }
  catch (error) {
    markFailed(row.id, error)
    throw error
  }
}

export function listForSession(sessionId: string): TurnCheckpointView[] {
  return db()
    .select()
    .from(turnCheckpoints)
    .where(eq(turnCheckpoints.sessionId, sessionId))
    .orderBy(desc(checkpointInsertOrder))
    .all()
}

export function get(checkpointId: string): TurnCheckpointView | null {
  return db().select().from(turnCheckpoints).where(eq(turnCheckpoints.id, checkpointId)).get() ?? null
}

export async function restoreWorkspaceStart(input: {
  sessionId: string
  checkpointId: string
}): Promise<TurnCheckpointView> {
  const row = get(input.checkpointId)
  if (!row || row.sessionId !== input.sessionId) {
    throw new AppError({
      code: 'turn_checkpoint_not_found',
      status: 404,
      message: 'Turn checkpoint not found',
      details: input,
    })
  }
  const latest = listForSession(input.sessionId).find(checkpoint => checkpoint.status === 'completed')
  if (latest?.id !== row.id) {
    throw new AppError({
      code: 'turn_checkpoint_restore_not_latest',
      status: 409,
      message: 'Only the latest completed turn can be restored safely',
      details: { sessionId: input.sessionId, checkpointId: input.checkpointId, latestCheckpointId: latest?.id ?? null },
    })
  }
  const restored = await restoreCheckpoint(row.workspacePath, row.startRef)
  if (!restored) {
    throw new AppError({
      code: 'turn_checkpoint_ref_missing',
      status: 409,
      message: 'The hidden Git ref for this turn checkpoint is unavailable',
      details: { checkpointId: row.id, ref: row.startRef },
    })
  }
  db().update(turnCheckpoints).set({
    restoredAt: currentUnixSeconds(),
    updatedAt: currentUnixSeconds(),
  }).where(eq(turnCheckpoints.id, row.id)).run()
  return requireCheckpoint(row.id)
}

export function planHistoricalRewind(input: {
  sessionId: string
  checkpointId: string
}): HistoricalRewindPlan {
  const checkpoint = requireSessionCheckpoint(input)
  if (checkpoint.status !== 'completed' || !checkpoint.endRef) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_not_completed',
      status: 409,
      message: 'Only a completed turn checkpoint can be used as a rewind target',
      details: { ...input, checkpointStatus: checkpoint.status },
    })
  }

  const checkpoints = listForSession(input.sessionId)
  const targetIndex = checkpoints.findIndex(candidate => candidate.id === checkpoint.id)
  const subsequentCheckpoints = checkpoints.slice(0, targetIndex)
  if (subsequentCheckpoints.length === 0) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_no_later_turns',
      status: 409,
      message: 'The selected checkpoint is already the latest completed turn',
      details: input,
    })
  }

  const incompleteCheckpoint = subsequentCheckpoints.find(candidate =>
    candidate.status !== 'completed' || !candidate.endRef)
  if (incompleteCheckpoint) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_history_incomplete',
      status: 409,
      message: 'A later turn does not have a completed checkpoint',
      details: {
        ...input,
        incompleteCheckpointId: incompleteCheckpoint.id,
        incompleteCheckpointStatus: incompleteCheckpoint.status,
      },
    })
  }

  const movedCheckpoint = subsequentCheckpoints.find(candidate =>
    candidate.workspacePath !== checkpoint.workspacePath)
  if (movedCheckpoint) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_workspace_changed',
      status: 409,
      message: 'Cannot rewind checkpoints captured from different workspace paths',
      details: {
        ...input,
        targetWorkspacePath: checkpoint.workspacePath,
        changedCheckpointId: movedCheckpoint.id,
        changedWorkspacePath: movedCheckpoint.workspacePath,
      },
    })
  }

  return {
    checkpoint,
    rollbackTurns: subsequentCheckpoints.length,
    subsequentCheckpoints,
  }
}

export async function restoreHistoricalCheckpoint(input: {
  sessionId: string
  checkpointId: string
  expectedSubsequentCheckpointIds: string[]
}): Promise<TurnCheckpointView> {
  const plan = planHistoricalRewind(input)
  const subsequentCheckpointIds = plan.subsequentCheckpoints.map(checkpoint => checkpoint.id)
  if (!sameIds(subsequentCheckpointIds, input.expectedSubsequentCheckpointIds)) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_history_changed',
      status: 409,
      message: 'Turn checkpoint history changed before rewind could start',
      details: {
        sessionId: input.sessionId,
        checkpointId: input.checkpointId,
        expectedSubsequentCheckpointIds: input.expectedSubsequentCheckpointIds,
        actualSubsequentCheckpointIds: subsequentCheckpointIds,
      },
    })
  }

  const restored = await restoreCheckpoint(plan.checkpoint.workspacePath, plan.checkpoint.endRef!)
  if (!restored) {
    throw new AppError({
      code: 'turn_checkpoint_ref_missing',
      status: 409,
      message: 'The hidden Git ref for this turn checkpoint is unavailable',
      details: { checkpointId: plan.checkpoint.id, ref: plan.checkpoint.endRef },
    })
  }

  const now = currentUnixSeconds()
  db().update(turnCheckpoints).set({
    restoredAt: now,
    updatedAt: now,
  }).where(eq(turnCheckpoints.id, plan.checkpoint.id)).run()
  return requireCheckpoint(plan.checkpoint.id)
}

export async function cleanupHistoricalRewind(input: {
  sessionId: string
  checkpointId: string
  subsequentCheckpointIds: string[]
}): Promise<void> {
  const plan = planHistoricalRewind(input)
  const actualSubsequentCheckpointIds = plan.subsequentCheckpoints.map(checkpoint => checkpoint.id)
  if (!sameIds(actualSubsequentCheckpointIds, input.subsequentCheckpointIds)) {
    throw new AppError({
      code: 'turn_checkpoint_rewind_history_changed',
      status: 409,
      message: 'Turn checkpoint history changed before rewind cleanup completed',
      details: {
        ...input,
        actualSubsequentCheckpointIds,
      },
    })
  }

  await deleteCheckpointRefs(
    plan.checkpoint.workspacePath,
    plan.subsequentCheckpoints.flatMap(row => row.endRef ? [row.startRef, row.endRef] : [row.startRef]),
  )
  if (input.subsequentCheckpointIds.length > 0) {
    db().delete(turnCheckpoints).where(and(
      eq(turnCheckpoints.sessionId, input.sessionId),
      inArray(turnCheckpoints.id, input.subsequentCheckpointIds),
    )).run()
  }
}

function requireSessionCheckpoint(input: {
  sessionId: string
  checkpointId: string
}): TurnCheckpointView {
  const checkpoint = get(input.checkpointId)
  if (!checkpoint || checkpoint.sessionId !== input.sessionId) {
    throw new AppError({
      code: 'turn_checkpoint_not_found',
      status: 404,
      message: 'Turn checkpoint not found',
      details: input,
    })
  }
  return checkpoint
}

function sameIds(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index])
}

function requireCheckpoint(id: string): TurnCheckpointView {
  const row = get(id)
  if (!row) {
    throw new Error(`Turn checkpoint ${id} disappeared during update`)
  }
  return row
}

function markFailed(id: string, error: unknown): void {
  db().update(turnCheckpoints).set({
    status: 'failed',
    errorText: error instanceof Error ? error.message : String(error),
    updatedAt: currentUnixSeconds(),
  }).where(eq(turnCheckpoints.id, id)).run()
}
