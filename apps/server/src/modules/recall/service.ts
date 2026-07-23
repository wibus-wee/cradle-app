import {
  backendRuns,
  backendRunSnapshotEvents,
  chatMessagePayloads,
  messages,
  recallMessages,
  recallRuns,
  recallToolEvents,
  sessions,
} from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import type { ChatRuntimeWriteDb } from '../chat-runtime/es/event-store'
import { messagePayloadJoinCondition } from '../chat-runtime/message-payload-store'

const MAX_EXCERPT_LENGTH = 8_000

type RecallProjectionDb = Pick<ChatRuntimeWriteDb, 'insert' | 'select'>

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

  d.insert(recallToolEvents)
    .values({
      id: row.event.id,
      runId: row.event.runId,
      sessionId: row.event.chatSessionId,
      workspaceId: row.workspaceId,
      sourceEventId: row.event.id,
      toolCallId: row.event.toolCallId,
      toolName: row.event.toolName,
      phase: row.event.phase,
      isFailure: isFailureEvent(row.event.phase, row.event.payloadJson) ? 1 : 0,
      summary: truncate(
        `${row.event.toolName ?? row.event.chunkType ?? row.event.phase}: ${row.event.payloadJson}`,
      ),
      occurredAt: row.event.occurredAt,
    })
    .onConflictDoUpdate({
      target: recallToolEvents.sourceEventId,
      set: {
        runId: row.event.runId,
        toolCallId: row.event.toolCallId,
        toolName: row.event.toolName,
        phase: row.event.phase,
        isFailure: isFailureEvent(row.event.phase, row.event.payloadJson) ? 1 : 0,
        summary: truncate(
          `${row.event.toolName ?? row.event.chunkType ?? row.event.phase}: ${row.event.payloadJson}`,
        ),
        occurredAt: row.event.occurredAt,
      },
    })
    .run()
}

export function rebuildRecallProjection(d: RecallProjectionDb): void {
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

function truncate(value: string): string {
  return value.length <= MAX_EXCERPT_LENGTH ? value : `${value.slice(0, MAX_EXCERPT_LENGTH)}...`
}

function isFailureEvent(phase: string, payloadJson: string): boolean {
  return (
    /fail|error|exception/i.test(phase)
    || /"(?:error|status)"\s*:\s*"(?:failed|error)/i.test(payloadJson)
  )
}
