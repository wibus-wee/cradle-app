import { randomUUID } from 'node:crypto'

import { chatMessagePayloads, chatSessionQueueItems, messages, threadHandoffs } from '@cradle/db'
import type { UIMessage } from 'ai'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { recordImportedSessionMessages } from '../chat-runtime/es/commands'
import type { MessageRecordedFact } from '../chat-runtime/es/events'
import { toDurableMessagePayload } from '../chat-runtime/message-durable-payload'
import { messagePayloadJoinCondition } from '../chat-runtime/message-payload-store'
import { runRegistry } from '../chat-runtime/run-registry'
import type { ChatThinkingEffort } from '../chat-runtime/runtime-provider-types'
import { resolveMessageBlobReferences } from '../chat-runtime/ui-message'
import { assertAppFeatureFlagEnabled } from '../preferences/service'
import { runtimeSkipsProviderTarget } from '../provider-contracts/runtime-compatibility'
import type { RuntimeKind } from '../provider-contracts/types'
import * as ProviderTargets from '../provider-targets/service'
import * as Session from '../session/service'

export type ThreadHandoffView = typeof threadHandoffs.$inferSelect

export async function create(input: {
  requestId: string
  sourceSessionId: string
  destinationRuntimeKind: RuntimeKind
  destinationProviderTargetId?: string | null
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort | null
}): Promise<{ handoff: ThreadHandoffView, session: Session.SessionView }> {
  assertAppFeatureFlagEnabled('threadHandoffs', {
    code: 'thread_handoffs_disabled',
    status: 403,
    message: 'Thread handoffs are disabled. Enable them in Cradle settings first.',
  })

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

  const target = input.destinationProviderTargetId
    ? ProviderTargets.getProviderTarget(input.destinationProviderTargetId)
    : null
  if (input.destinationProviderTargetId && (!target || !target.enabled)) {
    throw new AppError({
      code: 'thread_handoff_target_unavailable',
      status: 409,
      message: 'Destination provider target is unavailable',
      details: { providerTargetId: input.destinationProviderTargetId },
    })
  }
  if (!target && !runtimeSkipsProviderTarget(input.destinationRuntimeKind)) {
    throw new AppError({
      code: 'thread_handoff_target_required',
      status: 400,
      message: 'Destination runtime requires a provider target',
      details: { runtimeKind: input.destinationRuntimeKind },
    })
  }
  if (target && runtimeSkipsProviderTarget(input.destinationRuntimeKind)) {
    throw new AppError({
      code: 'thread_handoff_target_not_supported',
      status: 400,
      message: 'Destination runtime manages its own provider connection',
      details: {
        runtimeKind: input.destinationRuntimeKind,
        providerTargetId: target.id,
      },
    })
  }
  if (
    source.runtimeKind === input.destinationRuntimeKind
    && source.providerTargetId === (target?.id ?? null)
  ) {
    throw new AppError({
      code: 'thread_handoff_same_target',
      status: 409,
      message: 'Choose a different runtime or provider target for handoff',
      details: {
        runtimeKind: input.destinationRuntimeKind,
        providerTargetId: target?.id ?? null,
      },
    })
  }
  if (target) {
    ProviderTargets.assertProviderTargetCompatibleWithRuntime(target.id, input.destinationRuntimeKind)
  }

  const sourceMessageRows = readCompletedMessageRows(source.id)
  if (sourceMessageRows.length === 0) {
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
      providerTargetId: target?.id,
      runtimeKind: input.destinationRuntimeKind,
      modelId: input.modelId,
      thinkingEffort: input.thinkingEffort,
      linkedIssueId: source.linkedIssueId,
      sessionGroupId: source.sessionGroupId,
      worktreeId: source.worktreeId,
    })
    const reboundMessages = await buildImportedMessages(sourceMessageRows, destinationId)
    await recordImportedSessionMessages({ sessionId: destinationId, messages: reboundMessages })
    const handoff = db().insert(threadHandoffs).values({
      id: randomUUID(),
      requestId: input.requestId,
      sourceSessionId: source.id,
      destinationSessionId: destinationId,
      sourceProviderTargetId: source.providerTargetId,
      destinationProviderTargetId: target?.id ?? null,
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

function readCompletedMessageRows(sourceSessionId: string) {
  return db()
    .select({
      message: messages,
      messageJson: chatMessagePayloads.messageJson,
    })
    .from(messages)
    .innerJoin(chatMessagePayloads, messagePayloadJoinCondition())
    .where(and(
      eq(messages.sessionId, sourceSessionId),
      eq(messages.status, 'complete'),
      isNull(messages.parentToolCallId),
    ))
    .orderBy(asc(messages.createdAt))
    .all()
}

async function buildImportedMessages(
  rows: ReturnType<typeof readCompletedMessageRows>,
  destinationSessionId: string,
): Promise<Array<MessageRecordedFact & { status: 'complete' }>> {
  return await Promise.all(rows.map(async (row) => {
    const id = randomUUID()
    const sourceSnapshot = JSON.parse(row.messageJson) as UIMessage
    const resolvedSnapshot = await resolveMessageBlobReferences(sourceSnapshot)
    const message = {
      ...resolvedSnapshot,
      id,
      role: row.message.role,
    } as UIMessage
    const durable = toDurableMessagePayload({
      sessionId: destinationSessionId,
      message,
    })
    return {
      id,
      sessionId: destinationSessionId,
      parentMessageId: null,
      parentToolCallId: null,
      taskId: null,
      depth: 0,
      role: row.message.role,
      status: 'complete',
      content: durable.content,
      messageJson: durable.messageJson,
      errorText: null,
      createdAt: row.message.createdAt,
      updatedAt: row.message.updatedAt,
    }
  }))
}
