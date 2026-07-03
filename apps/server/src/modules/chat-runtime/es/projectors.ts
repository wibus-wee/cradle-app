import {
  backendRunSnapshots,
  backendRuns,
  chatSessionQueueItems,
  messages,
  sessions
} from '@cradle/db'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'

import type { ChatRuntimeWriteDb } from './event-store'
import type {
  ChatSessionEvent,
  QueueItemCancelledPayload,
  QueueItemClaimedPayload,
  QueueItemFailedPayload,
  QueueItemReleasedPayload,
  QueueItemReorderedPayload,
  QueueItemUpdatedPayload,
  QueueProjectionStatus,
  RunTerminalPayload,
  StoredChatSessionEvent
} from './events'

type ProjectorDb = Pick<ChatRuntimeWriteDb, 'insert' | 'update'>
  & Pick<ChatRuntimeWriteDb, 'delete'>

export function projectSessionEvent(d: ProjectorDb, event: StoredChatSessionEvent): void {
  projectChatSessionEvent(d, {
    type: event.type,
    payload: event.payload
  } as ChatSessionEvent)
}

export function projectChatSessionEvent(d: ProjectorDb, event: ChatSessionEvent): void {
  switch (event.type) {
    case 'UserMessageAppended':
      d.insert(messages).values(event.payload.message).run()
      touchSession(d, event.payload.message.sessionId, event.payload.message.updatedAt)
      break
    case 'RunStarted':
      if (event.payload.assistantMessage) {
        if (event.payload.assistantMessageProjection === 'update') {
          d.update(messages)
            .set({
              status: event.payload.assistantMessage.status,
              errorText: event.payload.assistantMessage.errorText ?? null,
              content: event.payload.assistantMessage.content,
              messageJson: event.payload.assistantMessage.messageJson,
              updatedAt: event.payload.assistantMessage.updatedAt
            })
            .where(
              and(
                eq(messages.id, event.payload.assistantMessage.id),
                eq(messages.sessionId, event.payload.assistantMessage.sessionId),
                eq(messages.role, 'assistant')
              )
            )
            .run()
        } else {
          d.insert(messages).values(event.payload.assistantMessage).run()
        }
      }
      d.insert(backendRuns).values(event.payload.run).run()
      if (event.payload.queueItemId) {
        projectQueueItemClaimed(d, {
          queueItemId: event.payload.queueItemId,
          sessionId: event.payload.run.chatSessionId,
          startedRunId: event.payload.run.id,
          updatedAt: event.payload.run.startedAt
        })
      }
      touchSession(d, event.payload.run.chatSessionId, event.payload.run.startedAt)
      break
    case 'AssistantMessageCompleted':
      d.update(messages)
        .set({
          content: event.payload.message.content,
          messageJson: event.payload.message.messageJson,
          status: event.payload.message.status,
          errorText: event.payload.message.errorText,
          updatedAt: event.payload.message.updatedAt
        })
        .where(
          and(
            eq(messages.id, event.payload.message.id),
            eq(messages.sessionId, event.payload.message.sessionId)
          )
        )
        .run()
      touchSession(d, event.payload.message.sessionId, event.payload.message.updatedAt)
      break
    case 'RunCompleted':
    case 'RunFailed':
    case 'RunAborted':
      projectRunTerminal(d, event.payload)
      break
    case 'InteractionRequested':
    case 'InteractionResolved':
      break
    case 'QueueItemEnqueued':
      d.insert(chatSessionQueueItems).values(event.payload.item).run()
      touchSession(d, event.payload.item.sessionId, event.payload.item.updatedAt)
      break
    case 'QueueItemClaimed':
      projectQueueItemClaimed(d, event.payload)
      break
    case 'QueueItemReleased':
      projectQueueItemReleased(d, event.payload)
      break
    case 'QueueItemFailed':
      projectQueueItemFailed(d, event.payload)
      break
    case 'QueueItemReordered':
      projectQueueItemReordered(d, event.payload)
      break
    case 'QueueItemUpdated':
      projectQueueItemUpdated(d, event.payload)
      break
    case 'QueueItemCancelled':
      projectQueueItemCancelled(d, event.payload)
      break
    case 'SteerApplied':
      d.insert(messages).values(event.payload.message).run()
      touchSession(d, event.payload.message.sessionId, event.payload.message.updatedAt)
      break
    case 'LastTurnRolledBack':
      if (event.payload.messageIds.length > 0) {
        d.delete(messages)
          .where(
            and(
              eq(messages.sessionId, event.payload.sessionId),
              inArray(messages.id, event.payload.messageIds)
            )
          )
          .run()
      }
      touchSession(d, event.payload.sessionId, event.payload.updatedAt)
      break
    case 'TitleChanged':
      d.update(sessions)
        .set({
          title: event.payload.title,
          titleSource: event.payload.titleSource,
          updatedAt: event.payload.updatedAt
        })
        .where(eq(sessions.id, event.payload.sessionId))
        .run()
      break
  }
}

function projectRunTerminal(d: ProjectorDb, payload: RunTerminalPayload): void {
  d.update(backendRuns)
    .set({
      ...(payload.bindingId !== undefined ? { bindingId: payload.bindingId } : {}),
      status: payload.status,
      stopReason: payload.stopReason,
      errorText: payload.errorText,
      finishedAt: payload.finishedAt
    })
    .where(eq(backendRuns.id, payload.runId))
    .run()

  if (payload.queueItemId) {
    projectRunTerminalQueueItem(d, {
      queueItemId: payload.queueItemId,
      sessionId: payload.sessionId,
      status:
        payload.status === 'complete'
          ? 'completed'
          : payload.status === 'aborted'
            ? 'cancelled'
            : 'failed',
      startedRunId: payload.runId,
      errorText: payload.errorText,
      updatedAt: payload.finishedAt
    })
  }
  d.update(backendRunSnapshots)
    .set({
      status: payload.status,
      completedAt: payload.finishedAt * 1000,
      completionReason: payload.stopReason,
      errorText: payload.errorText
    })
    .where(
      and(eq(backendRunSnapshots.runId, payload.runId), eq(backendRunSnapshots.status, 'running'))
    )
    .run()
  touchSession(d, payload.sessionId, payload.finishedAt)
}

function projectQueueItemCancelled(d: ProjectorDb, payload: QueueItemCancelledPayload): void {
  d.update(chatSessionQueueItems)
    .set({
      status: 'cancelled',
      errorText: null,
      updatedAt: payload.updatedAt
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, payload.queueItemId),
        eq(chatSessionQueueItems.sessionId, payload.sessionId),
        eq(chatSessionQueueItems.mode, 'queue'),
        or(
          eq(chatSessionQueueItems.status, 'pending'),
          and(
            eq(chatSessionQueueItems.status, 'running'),
            isNull(chatSessionQueueItems.startedRunId)
          )
        )
      )
    )
    .run()
  touchSession(d, payload.sessionId, payload.updatedAt)
}

function projectQueueItemClaimed(d: ProjectorDb, payload: QueueItemClaimedPayload): void {
  d.update(chatSessionQueueItems)
    .set({
      status: 'running',
      errorText: null,
      ...(payload.startedRunId !== undefined && payload.startedRunId !== null
        ? { startedRunId: payload.startedRunId }
        : {}),
      updatedAt: payload.updatedAt
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, payload.queueItemId),
        eq(chatSessionQueueItems.sessionId, payload.sessionId),
        eq(chatSessionQueueItems.mode, 'queue')
      )
    )
    .run()
  touchSession(d, payload.sessionId, payload.updatedAt)
}

function projectQueueItemReleased(d: ProjectorDb, payload: QueueItemReleasedPayload): void {
  d.update(chatSessionQueueItems)
    .set({
      status: 'pending',
      startedRunId: null,
      errorText: null,
      updatedAt: payload.updatedAt
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, payload.queueItemId),
        eq(chatSessionQueueItems.sessionId, payload.sessionId),
        eq(chatSessionQueueItems.mode, 'queue')
      )
    )
    .run()
  touchSession(d, payload.sessionId, payload.updatedAt)
}

function projectQueueItemFailed(d: ProjectorDb, payload: QueueItemFailedPayload): void {
  d.update(chatSessionQueueItems)
    .set({
      status: 'failed',
      errorText: payload.errorText,
      updatedAt: payload.updatedAt
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, payload.queueItemId),
        eq(chatSessionQueueItems.sessionId, payload.sessionId),
        eq(chatSessionQueueItems.mode, 'queue')
      )
    )
    .run()
  touchSession(d, payload.sessionId, payload.updatedAt)
}

function projectQueueItemReordered(d: ProjectorDb, payload: QueueItemReorderedPayload): void {
  d.update(chatSessionQueueItems)
    .set({
      status: 'pending',
      position: payload.position,
      updatedAt: payload.updatedAt
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, payload.queueItemId),
        eq(chatSessionQueueItems.sessionId, payload.sessionId),
        eq(chatSessionQueueItems.mode, 'queue')
      )
    )
    .run()
  touchSession(d, payload.sessionId, payload.updatedAt)
}

function projectQueueItemUpdated(d: ProjectorDb, payload: QueueItemUpdatedPayload): void {
  d.update(chatSessionQueueItems)
    .set({
      text: payload.text,
      filesJson: payload.filesJson,
      contextPartsJson: payload.contextPartsJson,
      providerTargetId: payload.providerTargetId,
      modelId: payload.modelId,
      thinkingEffort: payload.thinkingEffort,
      runtimeAccessMode: payload.runtimeAccessMode,
      runtimeInteractionMode: payload.runtimeInteractionMode,
      updatedAt: payload.updatedAt
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, payload.queueItemId),
        eq(chatSessionQueueItems.sessionId, payload.sessionId),
        eq(chatSessionQueueItems.mode, 'queue'),
        eq(chatSessionQueueItems.status, 'pending')
      )
    )
    .run()
  touchSession(d, payload.sessionId, payload.updatedAt)
}

/**
 * Synthetic queue-item update derived from a terminal run event (RunCompleted /
 * RunFailed / RunAborted). Unlike the per-intent event projectors above, this
 * carries an explicit status (completed / cancelled / failed) plus the run id
 * and error text — there is no dedicated 'completed' event because that state
 * is derived from RunCompleted.
 */
function projectRunTerminalQueueItem(
  d: ProjectorDb,
  payload: {
    queueItemId: string
    sessionId: string
    status: QueueProjectionStatus
    startedRunId: string
    errorText: string | null
    updatedAt: number
  }
): void {
  d.update(chatSessionQueueItems)
    .set({
      status: payload.status,
      startedRunId: payload.startedRunId,
      errorText: payload.errorText,
      updatedAt: payload.updatedAt
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, payload.queueItemId),
        eq(chatSessionQueueItems.sessionId, payload.sessionId),
        eq(chatSessionQueueItems.mode, 'queue')
      )
    )
    .run()
  touchSession(d, payload.sessionId, payload.updatedAt)
}

function touchSession(d: ProjectorDb, sessionId: string, updatedAt: number | undefined): void {
  if (updatedAt === undefined) {
    return
  }
  d.update(sessions).set({ updatedAt }).where(eq(sessions.id, sessionId)).run()
}
