import { backendSessionBindings, usageLogs } from '@cradle/db'
import { and, eq, isNull } from 'drizzle-orm'

import { db } from '../../infra'
import type { RuntimeUsageEvent } from '../chat-runtime/runtime-provider-types'

export interface RuntimeUsageEventContext {
  event: RuntimeUsageEvent
  sessionId: string
  runId: string | null
  messageId: string | null
  providerTargetId: string | null
  providerSessionId: string
}

export function recordRuntimeUsageEvent(input: RuntimeUsageEventContext): 'inserted' | 'duplicate' {
  validateRuntimeUsageEventContext(input)
  const result = insertRuntimeUsageEvent(db(), input)
  return result.changes > 0 ? 'inserted' : 'duplicate'
}

export function replaceLegacyRuntimeUsage(input: {
  sessionId: string
  runtimeKind: string
  events: RuntimeUsageEventContext[]
}): { inserted: number, duplicates: number } {
  for (const event of input.events) {
    validateRuntimeUsageEventContext(event)
    if (event.sessionId !== input.sessionId) {
      throw new Error('Runtime usage reconciliation events must belong to one Cradle session.')
    }
  }

  const binding = db().select({ id: backendSessionBindings.id }).from(backendSessionBindings).where(and(
      eq(backendSessionBindings.chatSessionId, input.sessionId),
      eq(backendSessionBindings.runtimeKind, input.runtimeKind),
    )).get()
  if (!binding) {
    throw new Error('Runtime usage reconciliation can only replace a matching session binding.')
  }

  return db().transaction((tx) => {
    let inserted = 0
    let duplicates = 0
    for (const event of input.events) {
      const result = insertRuntimeUsageEvent(tx, event)
      if (result.changes > 0) {
        inserted += 1
      }
      else {
        duplicates += 1
      }
    }
    tx.delete(usageLogs)
      .where(and(eq(usageLogs.sessionId, input.sessionId), isNull(usageLogs.providerThreadId)))
      .run()
    return { inserted, duplicates }
  })
}

function insertRuntimeUsageEvent(database: ReturnType<typeof db>, input: RuntimeUsageEventContext) {
  return database
    .insert(usageLogs)
    .values({
      id: input.event.id,
      runId: input.runId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      providerTargetId: input.providerTargetId,
      providerSessionId: input.providerSessionId,
      providerThreadId: input.event.providerThreadId,
      providerTurnId: input.event.providerTurnId,
      modelId: input.event.modelId,
      promptTokens: input.event.usage.promptTokens,
      cachedInputTokens: input.event.usage.cachedInputTokens ?? 0,
      completionTokens: input.event.usage.completionTokens,
      reasoningOutputTokens: input.event.usage.reasoningOutputTokens ?? 0,
      totalTokens: input.event.usage.totalTokens,
      providerTotalPromptTokens: input.event.providerTotal.promptTokens,
      providerTotalCachedInputTokens: input.event.providerTotal.cachedInputTokens ?? 0,
      providerTotalCompletionTokens: input.event.providerTotal.completionTokens,
      providerTotalReasoningOutputTokens: input.event.providerTotal.reasoningOutputTokens ?? 0,
      providerTotalTokens: input.event.providerTotal.totalTokens,
      createdAt: input.event.occurredAt,
    })
    .onConflictDoNothing({ target: usageLogs.id })
    .run()
}

function validateRuntimeUsageEventContext(input: RuntimeUsageEventContext): void {
  const requiredValues = {
    eventId: input.event.id,
    sessionId: input.sessionId,
    providerSessionId: input.providerSessionId,
    providerThreadId: input.event.providerThreadId,
    providerTurnId: input.event.providerTurnId,
    modelId: input.event.modelId,
  }
  const missing = Object.entries(requiredValues).find(([, value]) => !value)
  if (missing) {
    throw new Error(`Runtime usage event is missing required ${missing[0]}.`)
  }
  if (input.event.usage.totalTokens <= 0) {
    throw new Error('Runtime usage event requires a positive totalTokens value.')
  }
}
