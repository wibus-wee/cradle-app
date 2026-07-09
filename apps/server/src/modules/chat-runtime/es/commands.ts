import type { ChatSessionQueueItem } from '@cradle/db'
import { chatSessionQueueItems } from '@cradle/db'
import { and, eq, isNull } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import type { ChatMessageStatus } from '../run/stream-chunks'
import { reduceChatSessionEvents } from './aggregate'
import type { ChatSessionDomainError } from './decide'
import { decideChatSessionEvents } from './decide'
import type { ChatRuntimeTx } from './event-store'
import { appendSessionEvent, readSessionEvents } from './event-store'
import { publishSessionTailEvents } from './event-tail'
import type {
  ChatSessionEvent,
  MessageRecordedFact,
  QueueProjectionStatus,
  StoredChatSessionEvent,
  TerminalRunEventType,
} from './events'
import { projectSessionEvent } from './projectors'
import { runSessionActorTask } from './session-actor'

export function commitSessionEvents(sessionId: string, events: ChatSessionEvent[]): Promise<void> {
  if (events.length === 0) {
    return Promise.resolve()
  }
  return runSessionActorTask(sessionId, () =>
    commitSessionEventsInTransaction(sessionId, events)).then((storedEvents) => {
    publishSessionTailEvents(storedEvents)
  })
}

export function commitSessionEventsWithProjection(
  sessionId: string,
  events: ChatSessionEvent[],
  projectAdditionalChanges: (tx: ChatRuntimeTx) => void,
): Promise<void> {
  return runSessionActorTask(sessionId, () => {
    const storedEvents: StoredChatSessionEvent[] = []
    db().transaction((tx) => {
      storedEvents.push(...appendDecidedSessionEvents(tx, sessionId, events))
      projectAdditionalChanges(tx)
    })
    return storedEvents
  }).then((storedEvents) => {
    publishSessionTailEvents(storedEvents)
  })
}

export function commitSessionEventsInTransaction(
  sessionId: string,
  events: ChatSessionEvent[],
): StoredChatSessionEvent[] {
  const storedEvents: StoredChatSessionEvent[] = []
  db().transaction((tx) => {
    storedEvents.push(...appendDecidedSessionEvents(tx, sessionId, events))
  })
  return storedEvents
}

export function appendDecidedSessionEvents(
  tx: ChatRuntimeTx,
  sessionId: string,
  events: ChatSessionEvent[],
  options: {
    projectEvent?: (event: StoredChatSessionEvent) => boolean
  } = {},
): StoredChatSessionEvent[] {
  if (events.length === 0) {
    return []
  }

  const state = reduceChatSessionEvents(readSessionEvents(sessionId, tx))
  state.aggregateId = sessionId
  const decision = decideChatSessionEvents(state, events)
  if (!decision.ok) {
    throwDomainError(decision.error)
  }

  const storedEvents: StoredChatSessionEvent[] = []
  let expectedVersion = state.version
  for (const event of decision.events) {
    const stored = appendSessionEvent(tx, {
      aggregateId: sessionId,
      event,
      expectedVersion,
    })
    if (options.projectEvent?.(stored) ?? true) {
      projectSessionEvent(tx, stored)
    }
    storedEvents.push(stored)
    expectedVersion = stored.version
  }
  return storedEvents
}

export function readRunTerminalEventType(
  status: Exclude<ChatMessageStatus, 'streaming'>,
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
  status: Exclude<ChatMessageStatus, 'streaming'>,
): QueueProjectionStatus {
  return status === 'complete' ? 'completed' : status === 'aborted' ? 'cancelled' : 'failed'
}

export async function claimSessionQueueItem(
  sessionId: string,
  queueItemId: string,
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
            eq(chatSessionQueueItems.status, 'pending'),
          ),
        )
        .get()
      if (!row) {
        return { item: undefined, storedEvents: [] }
      }
      const updatedAt = currentUnixSeconds()
      const storedEvents = appendDecidedSessionEvents(tx, sessionId, [
        {
          type: 'QueueItemClaimed',
          payload: {
            queueItemId,
            sessionId,
            updatedAt,
          },
        },
      ])
      return {
        item: {
          ...row,
          status: 'running' as const,
          errorText: null,
          updatedAt,
        },
        storedEvents,
      }
    })
  })
  publishSessionTailEvents(result.storedEvents)
  return result.item
}

export async function releaseSessionQueueItem(
  sessionId: string,
  queueItemId: string,
): Promise<void> {
  const updatedAt = currentUnixSeconds()
  await commitSessionEvents(sessionId, [
    {
      type: 'QueueItemReleased',
      payload: { queueItemId, sessionId, updatedAt },
    },
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
        updatedAt: input.updatedAt ?? currentUnixSeconds(),
      },
    },
  ])
}

export async function recordImportedSessionMessages(input: {
  sessionId: string
  messages: Array<MessageRecordedFact & { status: 'complete' }>
}): Promise<void> {
  await commitSessionEvents(
    input.sessionId,
    input.messages.map((message): ChatSessionEvent => ({
      type: 'MessageImported',
      payload: { message },
    })),
  )
}

export function clearProviderTargetFromSessionQueuesInTransaction(
  tx: ChatRuntimeTx,
  input: {
    providerTargetId: string
    updatedAt: number
  },
): StoredChatSessionEvent[] {
  const rows = tx
    .select({
      id: chatSessionQueueItems.id,
      sessionId: chatSessionQueueItems.sessionId,
    })
    .from(chatSessionQueueItems)
    .where(eq(chatSessionQueueItems.providerTargetId, input.providerTargetId))
    .all()
  if (rows.length === 0) {
    return []
  }

  const rowsBySessionId = new Map<string, typeof rows>()
  for (const row of rows) {
    const sessionRows = rowsBySessionId.get(row.sessionId)
    if (sessionRows) {
      sessionRows.push(row)
    }
 else {
      rowsBySessionId.set(row.sessionId, [row])
    }
  }

  const storedEvents: StoredChatSessionEvent[] = []
  for (const [sessionId, sessionRows] of rowsBySessionId) {
    storedEvents.push(
      ...appendDecidedSessionEvents(
        tx,
        sessionId,
        sessionRows.map((row): ChatSessionEvent => ({
          type: 'QueueItemProviderTargetCleared',
          payload: {
            queueItemId: row.id,
            sessionId,
            providerTargetId: input.providerTargetId,
            updatedAt: input.updatedAt,
          },
        })),
      ),
    )
  }
  return storedEvents
}

export async function failSessionQueueItem(
  sessionId: string,
  queueItemId: string,
  errorText: string,
): Promise<void> {
  const updatedAt = currentUnixSeconds()
  await commitSessionEvents(sessionId, [
    {
      type: 'QueueItemFailed',
      payload: { queueItemId, sessionId, errorText, updatedAt },
    },
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
            isNull(chatSessionQueueItems.startedRunId),
          ),
        )
        .all()
      if (rows.length === 0) {
        return { count: 0, storedEvents: [] }
      }

      const updatedAt = currentUnixSeconds()
      const storedEvents = appendDecidedSessionEvents(
        tx,
        sessionId,
        rows.map((row): ChatSessionEvent => ({
          type: 'QueueItemReleased',
          payload: {
            queueItemId: row.id,
            sessionId,
            updatedAt,
          },
        })),
      )
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
            eq(chatSessionQueueItems.status, 'pending'),
          ),
        )
        .orderBy(chatSessionQueueItems.position, chatSessionQueueItems.createdAt)
        .all()

      const updatedAt = currentUnixSeconds()
      let changed = 0
      const events: ChatSessionEvent[] = []
      pendingRows.forEach((row, index) => {
        const position = index + 1
        if (row.position === position) {
          return
        }
        events.push({
          type: 'QueueItemReordered',
          payload: {
            queueItemId: row.id,
            sessionId,
            position,
            updatedAt,
          },
        })
        changed += 1
      })
      const storedEvents = appendDecidedSessionEvents(tx, sessionId, events)
      return { count: changed, storedEvents }
    })
  })
  publishSessionTailEvents(result.storedEvents)
  return result.count
}

export async function cancelQueuedSessionItem(
  sessionId: string,
  queueItemId: string,
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
          ),
        )
        .get()
      const cancellable
        = row !== undefined
          && (row.status === 'pending' || (row.status === 'running' && row.startedRunId === null))
      if (!row || !cancellable) {
        return { item: row, storedEvents: [] }
      }
      const updatedAt = currentUnixSeconds()
      const storedEvents = appendDecidedSessionEvents(tx, sessionId, [
        {
          type: 'QueueItemCancelled',
          payload: { queueItemId, sessionId, updatedAt },
        },
      ])
      return {
        item: {
          ...row,
          status: 'cancelled' as const,
          errorText: null,
          updatedAt,
        },
        storedEvents,
      }
    })
  })
  publishSessionTailEvents(result.storedEvents)
  return result.item
}

export async function recordQueuePositions(
  sessionId: string,
  rows: Array<Pick<ChatSessionQueueItem, 'id' | 'sessionId' | 'status' | 'position'>>,
): Promise<void> {
  const updatedAt = currentUnixSeconds()
  const events = rows.map(
    (row, index): ChatSessionEvent => ({
      type: 'QueueItemReordered',
      payload: {
        queueItemId: row.id,
        sessionId,
        position: index + 1,
        updatedAt,
      },
    }),
  )
  await commitSessionEvents(sessionId, events)
}

function throwDomainError(error: ChatSessionDomainError): never {
  throw new AppError({
    code: `chat_session_${error.code}`,
    status: 409,
    message: error.message,
    details: error.details,
  })
}
