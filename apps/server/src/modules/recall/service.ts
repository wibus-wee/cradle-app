import {
  backendRuns,
  backendRunSnapshotEvents,
  chatMessagePayloads,
  messages,
  recallFileTouches,
  recallMessages,
  recallRuns,
  recallToolEvents,
  sessions,
} from '@cradle/db'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'

import { db } from '../../infra'
import type { ChatRuntimeTx, ChatRuntimeWriteDb } from '../chat-runtime/es/event-store'
import { messagePayloadJoinCondition } from '../chat-runtime/message-payload-store'
import { extractRecallFileTouchPaths } from './file-touch-extractor'

const MAX_EXCERPT_LENGTH = 8_000
const RECONCILIATION_BATCH_SIZE = 500

type RecallProjectionDb = Pick<ChatRuntimeWriteDb, 'delete' | 'insert' | 'select'>

export interface RecallMessageProjectionInput {
  messageId: string
  isMeta?: boolean
}

export interface RecallRunProjectionInput {
  runId: string
}

export interface RecallToolEventProjectionInput {
  sourceEventId: string
}

export interface RecallToolEventRecordProjectionInput {
  sourceEvent: typeof backendRunSnapshotEvents.$inferSelect
  workspaceId: string | null
}

export interface RecallProjectionReconciliationResult {
  projectedMessages: number
  projectedRuns: number
  projectedToolEvents: number
  prunedToolEvents: number
}

export function projectRecallMessage(
  d: RecallProjectionDb,
  input: RecallMessageProjectionInput,
): void {
  const row = d
    .select({
      message: messages,
      payload: chatMessagePayloads,
      workspaceId: sessions.workspaceId,
    })
    .from(messages)
    .innerJoin(chatMessagePayloads, messagePayloadJoinCondition())
    .innerJoin(sessions, eq(sessions.id, messages.sessionId))
    .where(eq(messages.id, input.messageId))
    .get()

  if (!row || row.message.status === 'streaming') {
    return
  }

  d.insert(recallMessages)
    .values({
      messageId: row.message.id,
      sessionId: row.message.sessionId,
      workspaceId: row.workspaceId,
      role: row.message.role,
      status: row.message.status,
      isSidechain: row.message.parentToolCallId ? 1 : 0,
      isMeta: input.isMeta ? 1 : 0,
      excerpt: truncate(row.payload.content),
      occurredAt: row.message.updatedAt,
    })
    .onConflictDoUpdate({
      target: recallMessages.messageId,
      set: {
        status: row.message.status,
        isSidechain: row.message.parentToolCallId ? 1 : 0,
        isMeta: input.isMeta ? 1 : 0,
        excerpt: truncate(row.payload.content),
        occurredAt: row.message.updatedAt,
      },
    })
    .run()
}

export function projectRecallRun(d: RecallProjectionDb, input: RecallRunProjectionInput): void {
  const row = d
    .select({
      run: backendRuns,
      workspaceId: sessions.workspaceId,
    })
    .from(backendRuns)
    .innerJoin(sessions, eq(sessions.id, backendRuns.chatSessionId))
    .where(eq(backendRuns.id, input.runId))
    .get()

  if (!row) {
    return
  }

  d.insert(recallRuns)
    .values({
      runId: row.run.id,
      sessionId: row.run.chatSessionId,
      workspaceId: row.workspaceId,
      status: row.run.status,
      stopReason: row.run.stopReason,
      errorText: row.run.errorText,
      startedAt: row.run.startedAt,
      finishedAt: row.run.finishedAt,
    })
    .onConflictDoUpdate({
      target: recallRuns.runId,
      set: {
        status: row.run.status,
        stopReason: row.run.stopReason,
        errorText: row.run.errorText,
        finishedAt: row.run.finishedAt,
      },
    })
    .run()
}

export function projectRecallToolEvent(
  d: RecallProjectionDb,
  input: RecallToolEventProjectionInput,
): void {
  const row = d
    .select({
      event: backendRunSnapshotEvents,
      workspaceId: sessions.workspaceId,
    })
    .from(backendRunSnapshotEvents)
    .innerJoin(sessions, eq(sessions.id, backendRunSnapshotEvents.chatSessionId))
    .where(eq(backendRunSnapshotEvents.id, input.sourceEventId))
    .get()

  // A run snapshot also records text, lifecycle, and usage events. Recall's
  // tool-event read model only owns events tied to a concrete tool invocation.
  if (!row || !row.event.chatSessionId || !row.event.toolCallId) {
    return
  }

  projectRecallToolEventRecord(d, {
    sourceEvent: row.event,
    workspaceId: row.workspaceId,
  })
}

export function projectRecallToolEventRecord(
  d: RecallProjectionDb,
  input: RecallToolEventRecordProjectionInput,
): void {
  const event = input.sourceEvent
  if (!event.chatSessionId || !event.toolCallId) {
    return
  }

  d.insert(recallToolEvents)
    .values({
      id: event.id,
      runId: event.runId,
      sessionId: event.chatSessionId,
      workspaceId: input.workspaceId,
      sourceEventId: event.id,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      phase: event.phase,
      isFailure: isFailureEvent(event.phase, event.payloadJson) ? 1 : 0,
      summary: truncate(
        `${event.toolName ?? event.chunkType ?? event.phase}: ${event.payloadJson}`,
      ),
      occurredAt: event.occurredAt,
    })
    .onConflictDoUpdate({
      target: recallToolEvents.sourceEventId,
      set: {
        runId: event.runId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        phase: event.phase,
        isFailure: isFailureEvent(event.phase, event.payloadJson) ? 1 : 0,
        summary: truncate(
          `${event.toolName ?? event.chunkType ?? event.phase}: ${event.payloadJson}`,
        ),
        occurredAt: event.occurredAt,
      },
    })
    .run()

  d.delete(recallFileTouches).where(eq(recallFileTouches.toolEventId, event.id)).run()
  const paths = extractRecallFileTouchPaths(event)
  if (paths.length === 0) {
    return
  }
  d.insert(recallFileTouches)
    .values(paths.map(path => ({
      id: `${event.id}:${path}`,
      toolEventId: event.id,
      sessionId: event.chatSessionId!,
      workspaceId: input.workspaceId,
      path,
      occurredAt: event.occurredAt,
    })))
    .onConflictDoNothing()
    .run()
}

export function rebuildRecallProjection(d: RecallProjectionDb): void {
  d.delete(recallFileTouches).run()
  d.delete(recallToolEvents).run()
  d.delete(recallRuns).run()
  d.delete(recallMessages).run()

  const messageIds = d
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.status, 'complete')))
    .all()
  for (const row of messageIds) {
    projectRecallMessage(d, { messageId: row.id })
  }

  const runIds = d.select({ id: backendRuns.id }).from(backendRuns).all()
  for (const row of runIds) {
    projectRecallRun(d, { runId: row.id })
  }

  const toolEventIds = d
    .select({ id: backendRunSnapshotEvents.id })
    .from(backendRunSnapshotEvents)
    .all()
  for (const row of toolEventIds) {
    projectRecallToolEvent(d, { sourceEventId: row.id })
  }
}

/**
 * Repairs normal projection drift without rewriting the complete Recall read
 * model. Every batch commits independently so startup does not hold SQLite's
 * writer lock for the duration of the full evidence history.
 */
export function reconcileRecallProjection(): RecallProjectionReconciliationResult {
  const result: RecallProjectionReconciliationResult = {
    projectedMessages: 0,
    projectedRuns: 0,
    projectedToolEvents: 0,
    prunedToolEvents: 0,
  }

  result.projectedMessages = runReconciliationBatch((tx) => {
    const ids = tx
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(chatMessagePayloads, messagePayloadJoinCondition())
      .innerJoin(sessions, eq(sessions.id, messages.sessionId))
      .leftJoin(recallMessages, eq(recallMessages.messageId, messages.id))
      .where(and(eq(messages.status, 'complete'), isNull(recallMessages.messageId)))
      .limit(RECONCILIATION_BATCH_SIZE)
      .all()
      .map(row => row.id)
    for (const messageId of ids) {
      projectRecallMessage(tx, { messageId })
    }
    return ids.length
  })

  result.projectedRuns = runReconciliationBatch((tx) => {
    const ids = tx
      .select({ id: backendRuns.id })
      .from(backendRuns)
      .innerJoin(sessions, eq(sessions.id, backendRuns.chatSessionId))
      .leftJoin(recallRuns, eq(recallRuns.runId, backendRuns.id))
      .where(isNull(recallRuns.runId))
      .limit(RECONCILIATION_BATCH_SIZE)
      .all()
      .map(row => row.id)
    for (const runId of ids) {
      projectRecallRun(tx, { runId })
    }
    return ids.length
  })

  result.projectedToolEvents = runReconciliationBatch((tx) => {
    const ids = tx
      .select({ id: backendRunSnapshotEvents.id })
      .from(backendRunSnapshotEvents)
      .innerJoin(sessions, eq(sessions.id, backendRunSnapshotEvents.chatSessionId))
      .leftJoin(
        recallToolEvents,
        eq(recallToolEvents.sourceEventId, backendRunSnapshotEvents.id),
      )
      .where(and(
        isNull(recallToolEvents.id),
        isNotNull(backendRunSnapshotEvents.chatSessionId),
        isNotNull(backendRunSnapshotEvents.toolCallId),
      ))
      .limit(RECONCILIATION_BATCH_SIZE)
      .all()
      .map(row => row.id)
    for (const sourceEventId of ids) {
      projectRecallToolEvent(tx, { sourceEventId })
    }
    return ids.length
  })

  result.prunedToolEvents = runReconciliationBatch((tx) => {
    const ids = tx
      .select({ id: recallToolEvents.id })
      .from(recallToolEvents)
      .leftJoin(
        backendRunSnapshotEvents,
        eq(backendRunSnapshotEvents.id, recallToolEvents.sourceEventId),
      )
      .where(isNull(backendRunSnapshotEvents.id))
      .limit(RECONCILIATION_BATCH_SIZE)
      .all()
      .map(row => row.id)
    if (ids.length > 0) {
      tx.delete(recallToolEvents).where(inArray(recallToolEvents.id, ids)).run()
    }
    return ids.length
  })

  return result
}

function runReconciliationBatch(
  reconcileBatch: (tx: ChatRuntimeTx) => number,
): number {
  return db().transaction(reconcileBatch)
}

function truncate(value: string): string {
  return value.length <= MAX_EXCERPT_LENGTH ? value : `${value.slice(0, MAX_EXCERPT_LENGTH)}...`
}

function isFailureEvent(phase: string, payloadJson: string): boolean {
  return (
    /fail|error|exception/i.test(phase)
    || /"(?:error|status)"\s*:\s*"(?:failed|error)/i.test(payloadJson)
  )
}
