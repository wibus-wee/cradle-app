import type { ChatSessionQueueItem } from '@cradle/db'
import { chatSessionQueueItems } from '@cradle/db'
import { and, eq, isNull } from 'drizzle-orm'

import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import type { ChatMessageStatus } from '../run/stream-chunks'
import { publishSessionTailEvents } from './event-tail'
import { appendSessionEvent } from './event-store'
import type { ChatRuntimeTx } from './event-store'
import type {
  ChatSessionEvent,
  QueueProjectionStatus,
  StoredChatSessionEvent,
  TerminalRunEventType
} from './events'
import { projectSessionEvent } from './projectors'
import { runSessionActorTask } from './session-actor'

export function commitSessionEvents(sessionId: string, events: ChatSessionEvent[]): Promise<void> {
  if (events.length === 0) {
    return Promise.resolve()
  }
  return runSessionActorTask(sessionId, () =>
    commitSessionEventsInTransaction(sessionId, events)
  ).then((storedEvents) => {
    publishSessionTailEvents(storedEvents)
  })
}

export function commitSessionEventsWithProjection(
  sessionId: string,
  events: ChatSessionEvent[],
  projectAdditionalChanges: (tx: ChatRuntimeTx) => void
): Promise<void> {
  return runSessionActorTask(sessionId, () => {
    const storedEvents: StoredChatSessionEvent[] = []
    db().transaction((tx) => {
      for (const event of events) {
        const stored = appendSessionEvent(tx, {
          aggregateId: sessionId,
          event
        })
        projectSessionEvent(tx, stored)
        storedEvents.push(stored)
      }
      projectAdditionalChanges(tx)
    })
    return storedEvents
  }).then((storedEvents) => {
    publishSessionTailEvents(storedEvents)
  })
}

export function commitSessionEventsInTransaction(
  sessionId: string,
  events: ChatSessionEvent[]
): StoredChatSessionEvent[] {
  const storedEvents: StoredChatSessionEvent[] = []
  db().transaction((tx) => {
    for (const event of events) {
      const stored = appendSessionEvent(tx, {
        aggregateId: sessionId,
        event
      })
      projectSessionEvent(tx, stored)
      storedEvents.push(stored)
    }
  })
  return storedEvents
}

export function readRunTerminalEventType(
  status: Exclude<ChatMessageStatus, 'streaming'>
): TerminalRunEventType {
  return status === 'complete' ? 'RunCompleted' : status === 'aborted' ? 'RunAborted' : 'RunFailed'
}

export function readRunStopReason(status: Exclude<ChatMessageStatus, 'streaming'>): string {
  return status === 'complete'
    ? 'response.completed'
    : status === 'aborted'
      ? 'response.cancelled'
      : 'response.failed'
}

export function readQueueTerminalStatus(
  status: Exclude<ChatMessageStatus, 'streaming'>
): QueueProjectionStatus {
  return status === 'complete' ? 'completed' : status === 'aborted' ? 'cancelled' : 'failed'
}

export async function claimSessionQueueItem(
  sessionId: string,
  queueItemId: string
): Promise<ChatSessionQueueItem | undefined> {
  const result = await runSessionActorTask(sessionId, () => {
    return db().transaction((tx) => {
      const row = tx
        .select()
        .from(chatSessionQueueItems)
        .where(
          and(
            eq(chatSessionQueueItems.id, queueItemId),
            eq(chatSessionQueueItems.sessionId, sessionId),
            eq(chatSessionQueueItems.mode, 'queue'),
            eq(chatSessionQueueItems.status, 'pending')
          )
        )
        .get()
      if (!row) {
        return { item: undefined, storedEvents: [] }
      }
      const updatedAt = currentUnixSeconds()
      const stored = appendSessionEvent(tx, {
        aggregateId: sessionId,
        event: {
          type: 'QueueItemClaimed',
          payload: {
            queueItemId,
            sessionId,
            updatedAt
          }
        }
      })
      projectSessionEvent(tx, stored)
      return {
        item: {
          ...row,
          status: 'running' as const,
          errorText: null,
          updatedAt
        },
        storedEvents: [stored]
      }
    })
  })
  publishSessionTailEvents(result.storedEvents)
  return result.item
}

export async function releaseSessionQueueItem(
  sessionId: string,
  queueItemId: string
): Promise<void> {
  const updatedAt = currentUnixSeconds()
  await commitSessionEvents(sessionId, [
    {
      type: 'QueueItemReleased',
      payload: { queueItemId, sessionId, updatedAt }
    }
  ])
}

export async function commitLastTurnRolledBack(input: {
  sessionId: string
  messageIds: string[]
  providerRuntimeKind: string
  providerSessionId: string | null
  providerRolledBackTurns: number
  fileChangesReverted: false
  updatedAt?: number
}): Promise<void> {
  await commitSessionEvents(input.sessionId, [
    {
      type: 'LastTurnRolledBack',
      payload: {
        sessionId: input.sessionId,
        messageIds: input.messageIds,
        providerRuntimeKind: input.providerRuntimeKind,
        providerSessionId: input.providerSessionId,
        providerRolledBackTurns: input.providerRolledBackTurns,
        fileChangesReverted: input.fileChangesReverted,
        updatedAt: input.updatedAt ?? currentUnixSeconds()
      }
    }
  ])
}

export async function failSessionQueueItem(
  sessionId: string,
  queueItemId: string,
  errorText: string
): Promise<void> {
  const updatedAt = currentUnixSeconds()
  await commitSessionEvents(sessionId, [
    {
      type: 'QueueItemFailed',
      payload: { queueItemId, sessionId, errorText, updatedAt }
    }
  ])
}

export async function recoverOrphanedQueueItemClaims(sessionId: string): Promise<number> {
  const result = await runSessionActorTask(sessionId, () => {
    return db().transaction((tx) => {
      const rows = tx
        .select()
        .from(chatSessionQueueItems)
        .where(
          and(
            eq(chatSessionQueueItems.sessionId, sessionId),
            eq(chatSessionQueueItems.mode, 'queue'),
            eq(chatSessionQueueItems.status, 'running'),
            isNull(chatSessionQueueItems.startedRunId)
          )
        )
        .all()
      if (rows.length === 0) {
        return { count: 0, storedEvents: [] }
      }

      const updatedAt = currentUnixSeconds()
      const storedEvents: StoredChatSessionEvent[] = []
      for (const row of rows) {
        const stored = appendSessionEvent(tx, {
          aggregateId: sessionId,
          event: {
            type: 'QueueItemReleased',
            payload: {
              queueItemId: row.id,
              sessionId,
              updatedAt
            }
          }
        })
        projectSessionEvent(tx, stored)
        storedEvents.push(stored)
      }
      return { count: rows.length, storedEvents }
    })
  })
  publishSessionTailEvents(result.storedEvents)
  return result.count
}

export async function normalizeSessionQueuePositions(sessionId: string): Promise<number> {
  const result = await runSessionActorTask(sessionId, () => {
    return db().transaction((tx) => {
      const pendingRows = tx
        .select()
        .from(chatSessionQueueItems)
        .where(
          and(
            eq(chatSessionQueueItems.sessionId, sessionId),
            eq(chatSessionQueueItems.mode, 'queue'),
            eq(chatSessionQueueItems.status, 'pending')
          )
        )
        .orderBy(chatSessionQueueItems.position, chatSessionQueueItems.createdAt)
        .all()

      const updatedAt = currentUnixSeconds()
      let changed = 0
      const storedEvents: StoredChatSessionEvent[] = []
      pendingRows.forEach((row, index) => {
        const position = index + 1
        if (row.position === position) {
          return
        }
        const stored = appendSessionEvent(tx, {
          aggregateId: sessionId,
          event: {
            type: 'QueueItemReordered',
            payload: {
              queueItemId: row.id,
              sessionId,
              position,
              updatedAt
            }
          }
        })
        projectSessionEvent(tx, stored)
        storedEvents.push(stored)
        changed += 1
      })
      return { count: changed, storedEvents }
    })
  })
  publishSessionTailEvents(result.storedEvents)
  return result.count
}

export async function cancelQueuedSessionItem(
  sessionId: string,
  queueItemId: string
): Promise<ChatSessionQueueItem | undefined> {
  const result = await runSessionActorTask(sessionId, () => {
    return db().transaction((tx) => {
      const row = tx
        .select()
        .from(chatSessionQueueItems)
        .where(
          and(
            eq(chatSessionQueueItems.id, queueItemId),
            eq(chatSessionQueueItems.sessionId, sessionId),
            eq(chatSessionQueueItems.mode, 'queue')
          )
        )
        .get()
      const cancellable =
        row !== undefined &&
        (row.status === 'pending' || (row.status === 'running' && row.startedRunId === null))
      if (!row || !cancellable) {
        return { item: row, storedEvents: [] }
      }
      const updatedAt = currentUnixSeconds()
      const stored = appendSessionEvent(tx, {
        aggregateId: sessionId,
        event: {
          type: 'QueueItemCancelled',
          payload: { queueItemId, sessionId, updatedAt }
        }
      })
      projectSessionEvent(tx, stored)
      return {
        item: {
          ...row,
          status: 'cancelled' as const,
          errorText: null,
          updatedAt
        },
        storedEvents: [stored]
      }
    })
  })
  publishSessionTailEvents(result.storedEvents)
  return result.item
}

export async function recordQueuePositions(
  sessionId: string,
  rows: Array<Pick<ChatSessionQueueItem, 'id' | 'sessionId' | 'status' | 'position'>>
): Promise<void> {
  const updatedAt = currentUnixSeconds()
  const events = rows.map(
    (row, index): ChatSessionEvent => ({
      type: 'QueueItemReordered',
      payload: {
        queueItemId: row.id,
        sessionId,
        position: index + 1,
        updatedAt
      }
    })
  )
  await commitSessionEvents(sessionId, events)
}
