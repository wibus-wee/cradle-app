import { randomUUID } from 'node:crypto'

import { chatSessionQueueItems, messages, threadHandoffs } from '@cradle/db'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { recordImportedSessionMessages } from '../chat-runtime/es/commands'
import type { MessageRecordedFact } from '../chat-runtime/es/events'
import { runRegistry } from '../chat-runtime/run-registry'
import type { ChatThinkingEffort } from '../chat-runtime/runtime-provider-types'
import * as ProviderTargets from '../provider-targets/service'
import * as Session from '../session/service'

export type ThreadHandoffView = typeof threadHandoffs.$inferSelect

export async function create(input: {
  requestId: string
  sourceSessionId: string
  destinationProviderTargetId: string
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort | null
}): Promise<{ handoff: ThreadHandoffView, session: Session.SessionView }> {
  const previous = db().select().from(threadHandoffs).where(eq(threadHandoffs.requestId, input.requestId)).get()
  if (previous) {
    const session = Session.get(previous.destinationSessionId)
    if (session) {
      return { handoff: previous, session }
    }
  }

  const source = Session.get(input.sourceSessionId)
  if (!source) {
    throw new AppError({
      code: 'thread_handoff_source_not_found',
      status: 404,
      message: 'Source chat session not found',
      details: { sourceSessionId: input.sourceSessionId },
    })
  }
  assertSourceIdle(source.id)

  const target = ProviderTargets.getProviderTarget(input.destinationProviderTargetId)
  if (!target || !target.enabled) {
    throw new AppError({
      code: 'thread_handoff_target_unavailable',
      status: 409,
      message: 'Destination provider target is unavailable',
      details: { providerTargetId: input.destinationProviderTargetId },
    })
  }
  if (source.providerTargetId === target.id) {
    throw new AppError({
      code: 'thread_handoff_same_target',
      status: 409,
      message: 'Choose a different provider target for handoff',
      details: { providerTargetId: target.id },
    })
  }
  ProviderTargets.assertProviderTargetCompatibleWithRuntime(target.id, source.runtimeKind)

  const importedMessages = buildImportedMessages(source.id)
  if (importedMessages.length === 0) {
    throw new AppError({
      code: 'thread_handoff_empty_transcript',
      status: 409,
      message: 'The source session has no completed transcript to hand off',
      details: { sourceSessionId: source.id },
    })
  }

  const destinationId = randomUUID()
  let destination: Session.SessionView | null = null
  try {
    destination = await Session.create({
      id: destinationId,
      workspaceId: source.workspaceId,
      title: source.title?.trim() || 'Handoff',
      origin: 'thread-handoff',
      providerTargetId: target.id,
      runtimeKind: source.runtimeKind,
      modelId: input.modelId,
      thinkingEffort: input.thinkingEffort,
      linkedIssueId: source.linkedIssueId,
      sessionGroupId: source.sessionGroupId,
      worktreeId: source.worktreeId,
    })
    const reboundMessages = importedMessages.map(message => ({ ...message, sessionId: destinationId }))
    await recordImportedSessionMessages({ sessionId: destinationId, messages: reboundMessages })
    const handoff = db().insert(threadHandoffs).values({
      id: randomUUID(),
      requestId: input.requestId,
      sourceSessionId: source.id,
      destinationSessionId: destinationId,
      sourceProviderTargetId: source.providerTargetId,
      destinationProviderTargetId: target.id,
      importedMessageCount: reboundMessages.length,
      createdAt: currentUnixSeconds(),
    }).returning().get()
    return { handoff, session: destination }
  }
  catch (error) {
    if (destination) {
      await Session.remove(destination.id).catch(() => undefined)
    }
    throw error
  }
}

export function getByDestinationSessionId(sessionId: string): ThreadHandoffView | null {
  return db().select().from(threadHandoffs).where(eq(threadHandoffs.destinationSessionId, sessionId)).get() ?? null
}

function assertSourceIdle(sessionId: string): void {
  if (
    runRegistry.hasActiveRunForSession(sessionId)
    || runRegistry.hasPendingRun(sessionId)
    || runRegistry.hasSessionMaintenance(sessionId)
  ) {
    throw new AppError({
      code: 'thread_handoff_source_busy',
      status: 409,
      message: 'Wait for the active run to finish before handing off',
      details: { sessionId },
    })
  }
  const queued = db().select({ status: chatSessionQueueItems.status }).from(chatSessionQueueItems).where(and(
      eq(chatSessionQueueItems.sessionId, sessionId),
      inArray(chatSessionQueueItems.status, ['pending', 'running']),
    )).get()
  if (queued) {
    throw new AppError({
      code: 'thread_handoff_source_queue_busy',
      status: 409,
      message: 'Clear pending chat work before handing off',
      details: { sessionId },
    })
  }
}

function buildImportedMessages(sourceSessionId: string): Array<MessageRecordedFact & { status: 'complete' }> {
  const rows = db().select().from(messages).where(and(
    eq(messages.sessionId, sourceSessionId),
    eq(messages.status, 'complete'),
    isNull(messages.parentToolCallId),
  )).orderBy(asc(messages.createdAt)).all()

  return rows.map((row) => {
    const id = randomUUID()
    const snapshot = JSON.parse(row.messageJson) as Record<string, unknown>
    return {
      id,
      sessionId: '',
      parentMessageId: null,
      parentToolCallId: null,
      taskId: null,
      depth: 0,
      role: row.role,
      status: 'complete',
      content: row.content,
      messageJson: JSON.stringify({ ...snapshot, id, role: row.role }),
      errorText: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  })
}
