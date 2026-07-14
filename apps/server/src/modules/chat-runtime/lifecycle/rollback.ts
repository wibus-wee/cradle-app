import { chatSessionQueueItems, messages } from '@cradle/db'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { db } from '../../../infra'
import { commitLastTurnRolledBack } from '../es/commands'
import { cancelPendingRuntimeGoalContinuation } from '../run/runtime-goal-continuation'
import { runRegistry } from '../run-registry'
import {
  assertStoredSession,
  attachBinding,
  buildRuntimeProviderInput,
  resolveRuntimeSessionContext,
} from '../runtime-session-context'

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
  scheduleSessionQueueDrain: (sessionId: string) => void
}

export interface RollbackTurnsOptions {
  beforeProviderRollback?: () => Promise<void>
  afterRollback?: (result: RollbackLastTurnDto) => Promise<void>
}

export type RollbackLastTurnOptions = RollbackTurnsOptions

export async function rollbackLastTurn(
  sessionId: string,
  deps: RollbackLastTurnDeps,
  options: RollbackTurnsOptions = {},
): Promise<RollbackLastTurnDto> {
  return rollbackTurns(sessionId, 1, deps, options)
}

export async function rollbackTurns(
  sessionId: string,
  numTurns: number,
  deps: RollbackLastTurnDeps,
  options: RollbackTurnsOptions = {},
): Promise<RollbackLastTurnDto> {
  if (!Number.isInteger(numTurns) || numTurns < 1) {
    throw new AppError({
      code: 'chat_rollback_invalid_turn_count',
      status: 400,
      message: 'Rollback turn count must be a positive integer',
      details: { sessionId, numTurns },
    })
  }

  claimRollbackSession(sessionId)
  try {
    await deps.finalizeInterruptedPersistedStreamingSessionIfIdle(sessionId)

    const queue = readBlockingQueueCounts(sessionId)
    if (queue.pending > 0 || queue.running > 0) {
      throw new AppError({
        code: 'chat_rollback_queue_in_progress',
        status: 409,
        message: 'Chat session has pending or running queue items',
        details: { sessionId, queue },
      })
    }

    const tailRows = readTopLevelUserTurnTail(sessionId, numTurns)
    const streamingMessage = tailRows.find(row => row.status === 'streaming')
    if (streamingMessage) {
      throw new AppError({
        code: 'chat_rollback_streaming_tail',
        status: 409,
        message: 'Cannot roll back a streaming chat turn',
        details: { sessionId, messageId: streamingMessage.id },
      })
    }

    const resolved = await resolveRuntimeSessionContext(sessionId)
    const providerTurnCount = countProviderTurns(tailRows)
    if (providerTurnCount > 0) {
      readProviderRollback(sessionId, resolved)
    }
    await options.beforeProviderRollback?.()
    cancelPendingRuntimeGoalContinuation(sessionId)

    const messageIds = tailRows.map(row => row.id)
    const providerResult = providerTurnCount > 0
      ? await rollbackProviderTurns(sessionId, resolved, providerTurnCount)
      : {
          runtimeKind: resolved.runtimeKind,
          providerSessionId: resolved.runtimeSession.providerSessionId,
          rolledBackTurns: 0,
          fileChangesReverted: false as const,
        }

    try {
      await commitLastTurnRolledBack({
        sessionId,
        messageIds,
        providerRuntimeKind: providerResult.runtimeKind,
        providerSessionId: providerResult.providerSessionId,
        providerRolledBackTurns: providerResult.rolledBackTurns,
        fileChangesReverted: providerResult.fileChangesReverted,
      })
    }
    catch (error) {
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
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }

    attachBinding({
      sessionId,
      providerTargetId: resolved.context.providerTarget?.id ?? null,
      runtimeKind: resolved.runtimeSession.runtimeKind,
      runtimeSession: resolved.runtimeSession,
      requestedModelId: resolved.modelId ?? null,
    })

    const result: RollbackLastTurnDto = {
      ok: true,
      sessionId,
      messageIds,
      providerRuntimeKind: providerResult.runtimeKind,
      providerSessionId: providerResult.providerSessionId,
      providerRolledBackTurns: providerResult.rolledBackTurns,
      fileChangesReverted: providerResult.fileChangesReverted,
    }
    await options.afterRollback?.(result)
    return result
  }
  finally {
    runRegistry.releaseSessionMaintenance(sessionId, 'rollback')
    deps.scheduleSessionQueueDrain(sessionId)
  }
}

function claimRollbackSession(sessionId: string): void {
  if (runRegistry.claimSessionMaintenance(sessionId, 'rollback')) {
    return
  }
  const maintenanceKind = runRegistry.getSessionMaintenance(sessionId)
  if (maintenanceKind) {
    throw new AppError({
      code: 'chat_rollback_in_progress',
      status: 409,
      message: 'Chat session already has a rollback in progress',
      details: { sessionId, maintenanceKind },
    })
  }
  throw new AppError({
    code: 'chat_rollback_run_in_progress',
    status: 409,
    message: 'Chat session has an active or pending run',
    details: { sessionId },
  })
}

async function rollbackProviderTurns(
  sessionId: string,
  resolved: Awaited<ReturnType<typeof resolveRuntimeSessionContext>>,
  numTurns: number,
): Promise<{
  runtimeKind: string
  providerSessionId: string | null
  rolledBackTurns: number
  fileChangesReverted: false
}> {
  const rollback = readProviderRollback(sessionId, resolved)

  try {
    const result = await rollback.call(resolved.runtime, {
      ...buildRuntimeProviderInput(resolved),
      numTurns,
    })
    if (result.rolledBackTurns !== numTurns) {
      throw new AppError({
        code: 'chat_rollback_provider_count_mismatch',
        status: 502,
        message: 'The provider did not roll back the requested number of turns',
        details: {
          sessionId,
          runtimeKind: resolved.runtimeKind,
          providerSessionId: resolved.runtimeSession.providerSessionId,
          requestedTurns: numTurns,
          rolledBackTurns: result.rolledBackTurns,
        },
      })
    }
    return result
  }
  catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    throw new AppError({
      code: 'chat_rollback_provider_failed',
      status: 502,
      message: 'The provider failed to roll back the requested turns',
      details: {
        sessionId,
        runtimeKind: resolved.runtimeKind,
        providerSessionId: resolved.runtimeSession.providerSessionId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function readProviderRollback(
  sessionId: string,
  resolved: Awaited<ReturnType<typeof resolveRuntimeSessionContext>>,
) {
  if (
    !resolved.runtime.capabilities.supportsLastTurnRollback
    || !resolved.runtime.rollbackLastTurn
  ) {
    throw new AppError({
      code: 'chat_rollback_not_supported',
      status: 501,
      message: 'The current chat runtime does not support last-turn rollback',
      details: { sessionId, runtimeKind: resolved.runtimeKind },
    })
  }
  return resolved.runtime.rollbackLastTurn
}

export function shouldRollbackProviderTurn(tailRows: (typeof messages.$inferSelect)[]): boolean {
  return tailRows.some(row =>
    row.role === 'assistant'
    && (
      row.status !== 'failed'
      || row.content.trim().length > 0
      || hasNonEmptyMessageParts(row.messageJson)
    ))
}

export function countProviderTurns(tailRows: (typeof messages.$inferSelect)[]): number {
  let count = 0
  let turnStart = 0
  for (let index = 1; index <= tailRows.length; index += 1) {
    const row = tailRows[index]
    const startsNextTurn = row?.role === 'user' && row.status === 'complete'
    if (index < tailRows.length && !startsNextTurn) {
      continue
    }
    if (shouldRollbackProviderTurn(tailRows.slice(turnStart, index))) {
      count += 1
    }
    turnStart = index
  }
  return count
}

function hasNonEmptyMessageParts(messageJson: string): boolean {
  try {
    const parsed = JSON.parse(messageJson) as { parts?: unknown }
    return Array.isArray(parsed.parts) && parsed.parts.length > 0
  }
  catch {
    return true
  }
}

function readBlockingQueueCounts(sessionId: string): { pending: number, running: number } {
  const rows = db()
    .select({ status: chatSessionQueueItems.status })
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.sessionId, sessionId), eq(chatSessionQueueItems.mode, 'queue')),
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
    { pending: 0, running: 0 },
  )
}

function readTopLevelUserTurnTail(
  sessionId: string,
  numTurns: number,
): (typeof messages.$inferSelect)[] {
  assertStoredSession(sessionId)
  const rows = db()
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), isNull(messages.parentToolCallId)))
    .orderBy(messages.createdAt, messageInsertOrder)
    .all()

  const userIndices: number[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row?.role === 'user' && row.status === 'complete') {
      userIndices.push(index)
    }
  }

  if (userIndices.length < numTurns) {
    throw new AppError({
      code: 'chat_rollback_turn_count_out_of_range',
      status: 409,
      message: 'Chat session does not contain enough completed turns to roll back',
      details: { sessionId, requestedTurns: numTurns, availableTurns: userIndices.length },
    })
  }

  return rows.slice(userIndices[userIndices.length - numTurns]!)
}
