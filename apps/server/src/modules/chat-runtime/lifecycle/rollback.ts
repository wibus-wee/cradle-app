import { chatSessionQueueItems, messages } from '@cradle/db'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { db } from '../../../infra'
import { commitLastTurnRolledBack } from '../es/commands'
import { cancelPendingRuntimeGoalContinuation } from '../run/runtime-goal-continuation'
import {
  assertStoredSession,
  attachBinding,
  buildRuntimeProviderInput,
  resolveRuntimeSessionContext
} from '../runtime-session-context'
import { runRegistry } from '../run-registry'

const messageInsertOrder = sql`messages.rowid`

export interface RollbackLastTurnDto {
  ok: true
  sessionId: string
  messageIds: string[]
  providerRuntimeKind: string
  providerSessionId: string | null
  providerRolledBackTurns: number
  fileChangesReverted: false
}

export interface RollbackLastTurnDeps {
  finalizeInterruptedPersistedStreamingSessionIfIdle: (sessionId: string) => Promise<void>
}

export async function rollbackLastTurn(
  sessionId: string,
  deps: RollbackLastTurnDeps
): Promise<RollbackLastTurnDto> {
  await deps.finalizeInterruptedPersistedStreamingSessionIfIdle(sessionId)

  if (runRegistry.hasActiveRunForSession(sessionId) || runRegistry.hasPendingRun(sessionId)) {
    throw new AppError({
      code: 'chat_rollback_run_in_progress',
      status: 409,
      message: 'Chat session has an active or pending run',
      details: { sessionId }
    })
  }

  const queue = readBlockingQueueCounts(sessionId)
  if (queue.pending > 0 || queue.running > 0) {
    throw new AppError({
      code: 'chat_rollback_queue_in_progress',
      status: 409,
      message: 'Chat session has pending or running queue items',
      details: { sessionId, queue }
    })
  }

  const tailRows = readLastTopLevelUserTurnTail(sessionId)
  const streamingMessage = tailRows.find((row) => row.status === 'streaming')
  if (streamingMessage) {
    throw new AppError({
      code: 'chat_rollback_streaming_tail',
      status: 409,
      message: 'Cannot roll back a streaming chat turn',
      details: { sessionId, messageId: streamingMessage.id }
    })
  }

  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (
    !resolved.runtime.capabilities.supportsLastTurnRollback ||
    !resolved.runtime.rollbackLastTurn
  ) {
    throw new AppError({
      code: 'chat_rollback_not_supported',
      status: 501,
      message: 'The current chat runtime does not support last-turn rollback',
      details: { sessionId, runtimeKind: resolved.runtimeKind }
    })
  }

  cancelPendingRuntimeGoalContinuation(sessionId)
  const providerResult = await resolved.runtime.rollbackLastTurn(
    buildRuntimeProviderInput(resolved)
  )
  const messageIds = tailRows.map((row) => row.id)

  try {
    await commitLastTurnRolledBack({
      sessionId,
      messageIds,
      providerRuntimeKind: providerResult.runtimeKind,
      providerSessionId: providerResult.providerSessionId,
      providerRolledBackTurns: providerResult.rolledBackTurns,
      fileChangesReverted: providerResult.fileChangesReverted
    })
  } catch (error) {
    throw new AppError({
      code: 'chat_rollback_projection_failed',
      status: 500,
      message:
        'Provider rollback succeeded, but Cradle failed to record the transcript rollback. The session may need recovery.',
      details: {
        sessionId,
        messageIds,
        runtimeKind: providerResult.runtimeKind,
        providerSessionId: providerResult.providerSessionId,
        error: error instanceof Error ? error.message : String(error)
      }
    })
  }

  attachBinding({
    sessionId,
    providerTargetId: resolved.context.providerTarget?.id ?? null,
    runtimeKind: resolved.runtimeSession.runtimeKind,
    runtimeSession: resolved.runtimeSession,
    requestedModelId: resolved.modelId ?? null
  })

  return {
    ok: true,
    sessionId,
    messageIds,
    providerRuntimeKind: providerResult.runtimeKind,
    providerSessionId: providerResult.providerSessionId,
    providerRolledBackTurns: providerResult.rolledBackTurns,
    fileChangesReverted: providerResult.fileChangesReverted
  }
}

function readBlockingQueueCounts(sessionId: string): { pending: number; running: number } {
  const rows = db()
    .select({ status: chatSessionQueueItems.status })
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.sessionId, sessionId), eq(chatSessionQueueItems.mode, 'queue'))
    )
    .all()

  return rows.reduce(
    (counts, row) => {
      if (row.status === 'pending') {
        counts.pending += 1
      }
      if (row.status === 'running') {
        counts.running += 1
      }
      return counts
    },
    { pending: 0, running: 0 }
  )
}

function readLastTopLevelUserTurnTail(sessionId: string): (typeof messages.$inferSelect)[] {
  assertStoredSession(sessionId)
  const rows = db()
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), isNull(messages.parentToolCallId)))
    .orderBy(messages.createdAt, messageInsertOrder)
    .all()

  let lastUserIndex = -1
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row?.role === 'user' && row.status === 'complete') {
      lastUserIndex = index
      break
    }
  }

  if (lastUserIndex < 0) {
    throw new AppError({
      code: 'chat_rollback_no_turn',
      status: 409,
      message: 'Chat session has no completed user turn to roll back',
      details: { sessionId }
    })
  }

  return rows.slice(lastUserIndex)
}
