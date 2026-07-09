import type { ChatGlobalSessionTailEvent, ChatSessionTailEvent } from '@cradle/chat-runtime-contracts'
import { sessionEvents, sessions } from '@cradle/db'
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm'

import { db } from '../../../infra'
import type { StoredChatSessionEvent } from './events'
import {
  isLegacyAssistantMessageSnapshottedRow,
  parseStoredChatSessionEvent,
} from './events'

const encoder = new TextEncoder()
const DEFAULT_TAIL_LIMIT = 500
const KEEPALIVE_INTERVAL_MS = 15000

type ChatTailSubscriber = (event: ChatSessionTailEvent) => void
type ChatGlobalTailSubscriber = (event: PublishedSessionTailEvent) => void

interface PublishedSessionTailEvent {
  event: ChatSessionTailEvent
  workspaceId: string | null
}

const sessionSubscribers = new Map<string, Set<ChatTailSubscriber>>()
const globalSubscribers = new Set<ChatGlobalTailSubscriber>()

interface ChatTailReplay<TEvent extends ChatSessionTailEvent | ChatGlobalSessionTailEvent> {
  events: TEvent[]
  cursor: number
  snapshotRequired: TEvent | null
}

export interface ChatSessionTailQuery {
  sessionId: string
  afterVersion: number
  limit?: number
}

export interface ChatGlobalSessionsTailQuery {
  afterSequenceId: number
  workspaceId?: string | null
  limit?: number
}

export function toChatSessionTailEvent(event: StoredChatSessionEvent): ChatSessionTailEvent {
  return {
    scope: 'session',
    sessionId: event.aggregateId,
    sequenceId: event.sequenceId,
    version: event.version,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: readTailPayload(event),
  }
}

export function readSessionTailEvents(input: ChatSessionTailQuery): ChatSessionTailEvent[] {
  return readSessionTailReplay(input).events
}

export function replayChatSessionTail(input: ChatSessionTailQuery): ChatTailReplay<ChatSessionTailEvent> {
  return readSessionTailReplay(input)
}

function readSessionTailReplay(input: ChatSessionTailQuery): ChatTailReplay<ChatSessionTailEvent> {
  const limit = input.limit ?? DEFAULT_TAIL_LIMIT
  const rows = db()
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.aggregateId, input.sessionId),
        gt(sessionEvents.version, input.afterVersion),
      ),
    )
    .orderBy(asc(sessionEvents.version))
    .limit(limit + 1)
    .all()
  if (rows.length > limit) {
    const latest = readLatestSessionTailCursor(input.sessionId)
    return {
      events: [],
      cursor: latest?.version ?? input.afterVersion,
      snapshotRequired: latest
        ? toChatTailSnapshotRequiredEvent({
            scope: 'session',
            sessionId: input.sessionId,
            sequenceId: latest.sequenceId,
            version: latest.version,
            occurredAt: latest.occurredAt,
          })
        : null,
    }
  }

  const events = rows
    .filter(row => !isLegacyAssistantMessageSnapshottedRow(row))
    .map(row => toChatSessionTailEvent(parseStoredChatSessionEvent(row)))
  return {
    events,
    cursor: events.at(-1)?.version ?? input.afterVersion,
    snapshotRequired: null,
  }
}

export function readGlobalSessionTailEvents(input: ChatGlobalSessionsTailQuery): ChatGlobalSessionTailEvent[] {
  return readGlobalSessionTailReplay(input).events
}

export function replayChatGlobalSessionTail(
  input: ChatGlobalSessionsTailQuery,
): ChatTailReplay<ChatGlobalSessionTailEvent> {
  return readGlobalSessionTailReplay(input)
}

function readGlobalSessionTailReplay(
  input: ChatGlobalSessionsTailQuery,
): ChatTailReplay<ChatGlobalSessionTailEvent> {
  const limit = input.limit ?? DEFAULT_TAIL_LIMIT
  const conditions = [gt(sessionEvents.sequenceId, input.afterSequenceId)]
  if (input.workspaceId) {
    conditions.push(eq(sessions.workspaceId, input.workspaceId))
  }
  const rows = db()
    .select({
      sequenceId: sessionEvents.sequenceId,
      aggregateId: sessionEvents.aggregateId,
      aggregateType: sessionEvents.aggregateType,
      version: sessionEvents.version,
      eventType: sessionEvents.eventType,
      payload: sessionEvents.payload,
      subjectRunId: sessionEvents.subjectRunId,
      occurredAt: sessionEvents.occurredAt,
    })
    .from(sessionEvents)
    .innerJoin(sessions, eq(sessions.id, sessionEvents.aggregateId))
    .where(and(...conditions))
    .orderBy(asc(sessionEvents.sequenceId))
    .limit(limit + 1)
    .all()

  if (rows.length > limit) {
    const latest = readLatestGlobalSessionTailCursor(input.workspaceId ?? null)
    return {
      events: [],
      cursor: latest?.sequenceId ?? input.afterSequenceId,
      snapshotRequired: latest
        ? toChatTailSnapshotRequiredEvent({
            scope: 'sessions',
            sessionId: latest.aggregateId,
            sequenceId: latest.sequenceId,
            version: latest.version,
            occurredAt: latest.occurredAt,
          })
        : null,
    }
  }

  const events: ChatGlobalSessionTailEvent[] = rows
    .filter(row => !isLegacyAssistantMessageSnapshottedRow(row))
    .map((row) => {
      const event = toChatSessionTailEvent(parseStoredChatSessionEvent(row))
      return { ...event, scope: 'sessions' as const }
    })
  return {
    events,
    cursor: events.at(-1)?.sequenceId ?? input.afterSequenceId,
    snapshotRequired: null,
  }
}

export function publishSessionTailEvents(events: StoredChatSessionEvent[]): void {
  const tailEvents = events.map(stored => toChatSessionTailEvent(stored))
  const workspaceIdsBySessionId = readWorkspaceIdsBySessionId(tailEvents)
  for (const event of tailEvents) {
    const subscribers = sessionSubscribers.get(event.sessionId)
    if (subscribers) {
      for (const subscriber of subscribers) {
        subscriber(event)
      }
    }
    const workspaceId = workspaceIdsBySessionId.get(event.sessionId) ?? null
    for (const subscriber of globalSubscribers) {
      subscriber({ event, workspaceId })
    }
  }
}

export function openSessionEventTailStream(input: ChatSessionTailQuery): ReadableStream<Uint8Array> {
  const replay = readSessionTailReplay(input)
  return openTailStream({
    replay,
    subscribe: subscriber => subscribeSessionTail(input.sessionId, subscriber),
    readCatchupReplay: cursor =>
      readSessionTailReplay({
        ...input,
        afterVersion: cursor,
      }),
  })
}

export function openGlobalSessionEventTailStream(
  input: ChatGlobalSessionsTailQuery,
): ReadableStream<Uint8Array> {
  const replay = readGlobalSessionTailReplay(input)
  return openTailStream({
    replay,
    subscribe: subscriber => subscribeGlobalSessionTail(input.workspaceId ?? null, subscriber),
    readCatchupReplay: cursor =>
      readGlobalSessionTailReplay({
        ...input,
        afterSequenceId: cursor,
      }),
  })
}

export function subscribeChatSessionTail(sessionId: string, subscriber: ChatTailSubscriber): () => void {
  return subscribeSessionTail(sessionId, subscriber)
}

function subscribeSessionTail(sessionId: string, subscriber: ChatTailSubscriber): () => void {
  let subscribers = sessionSubscribers.get(sessionId)
  if (!subscribers) {
    subscribers = new Set()
    sessionSubscribers.set(sessionId, subscribers)
  }
  subscribers.add(subscriber)
  return () => {
    subscribers?.delete(subscriber)
    if (subscribers?.size === 0) {
      sessionSubscribers.delete(sessionId)
    }
  }
}

export function subscribeChatGlobalSessionTail(
  workspaceId: string | null,
  subscriber: (event: ChatGlobalSessionTailEvent) => void,
): () => void {
  return subscribeGlobalSessionTail(workspaceId, subscriber)
}

function subscribeGlobalSessionTail(
  workspaceId: string | null,
  subscriber: (event: ChatGlobalSessionTailEvent) => void,
): () => void {
  const wrapped = ({ event, workspaceId: eventWorkspaceId }: PublishedSessionTailEvent) => {
    if (workspaceId && eventWorkspaceId !== workspaceId) {
      return
    }
    subscriber({ ...event, scope: 'sessions' })
  }
  globalSubscribers.add(wrapped)
  return () => {
    globalSubscribers.delete(wrapped)
  }
}

function readWorkspaceIdsBySessionId(events: ChatSessionTailEvent[]): Map<string, string | null> {
  const sessionIds = [...new Set(events.map(event => event.sessionId))]
  if (sessionIds.length === 0 || globalSubscribers.size === 0) {
    return new Map()
  }

  const rows = db()
    .select({
      id: sessions.id,
      workspaceId: sessions.workspaceId,
    })
    .from(sessions)
    .where(inArray(sessions.id, sessionIds))
    .all()
  return new Map(rows.map(row => [row.id, row.workspaceId]))
}

export function openTailStream<TEvent extends ChatSessionTailEvent | ChatGlobalSessionTailEvent>(input: {
  replay: ChatTailReplay<TEvent>
  subscribe: (subscriber: (event: TEvent) => void) => () => void
  readCatchupReplay: (cursor: number) => ChatTailReplay<TEvent>
}): ReadableStream<Uint8Array> {
  let unsubscribe = () => {}
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let closed = false
  const close = () => {
    if (closed) {
      return
    }
    closed = true
    unsubscribe()
    if (keepAlive) {
      clearInterval(keepAlive)
      keepAlive = null
    }
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: TEvent) => {
        if (closed) {
          return
        }
        controller.enqueue(encodeTailEvent(event))
      }
      for (const event of input.replay.events) {
        send(event)
      }
      if (input.replay.snapshotRequired) {
        send(input.replay.snapshotRequired)
      }
      unsubscribe = input.subscribe(send)
      const catchup = input.readCatchupReplay(input.replay.cursor)
      for (const event of catchup.events) {
        send(event)
      }
      if (catchup.snapshotRequired) {
        send(catchup.snapshotRequired)
      }
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        }
 catch {
          close()
        }
      }, KEEPALIVE_INTERVAL_MS)
    },
    cancel() {
      close()
    },
  })
}

function readLatestSessionTailCursor(sessionId: string): {
  sequenceId: number
  version: number
  occurredAt: number
} | null {
  return db()
    .select({
      sequenceId: sessionEvents.sequenceId,
      version: sessionEvents.version,
      occurredAt: sessionEvents.occurredAt,
    })
    .from(sessionEvents)
    .where(eq(sessionEvents.aggregateId, sessionId))
    .orderBy(desc(sessionEvents.version))
    .limit(1)
    .get() ?? null
}

function readLatestGlobalSessionTailCursor(workspaceId: string | null): {
  aggregateId: string
  sequenceId: number
  version: number
  occurredAt: number
} | null {
  if (workspaceId) {
    return db()
      .select({
        aggregateId: sessionEvents.aggregateId,
        sequenceId: sessionEvents.sequenceId,
        version: sessionEvents.version,
        occurredAt: sessionEvents.occurredAt,
      })
      .from(sessionEvents)
      .innerJoin(sessions, eq(sessions.id, sessionEvents.aggregateId))
      .where(eq(sessions.workspaceId, workspaceId))
      .orderBy(desc(sessionEvents.sequenceId))
      .limit(1)
      .get() ?? null
  }
  return db()
    .select({
      aggregateId: sessionEvents.aggregateId,
      sequenceId: sessionEvents.sequenceId,
      version: sessionEvents.version,
      occurredAt: sessionEvents.occurredAt,
    })
    .from(sessionEvents)
    .innerJoin(sessions, eq(sessions.id, sessionEvents.aggregateId))
    .orderBy(desc(sessionEvents.sequenceId))
    .limit(1)
    .get() ?? null
}

function toChatTailSnapshotRequiredEvent(input: {
  scope: 'session'
  sessionId: string
  sequenceId: number
  version: number
  occurredAt: number
}): ChatSessionTailEvent
function toChatTailSnapshotRequiredEvent(input: {
  scope: 'sessions'
  sessionId: string
  sequenceId: number
  version: number
  occurredAt: number
}): ChatGlobalSessionTailEvent
function toChatTailSnapshotRequiredEvent(input: {
  scope: 'session' | 'sessions'
  sessionId: string
  sequenceId: number
  version: number
  occurredAt: number
}): ChatSessionTailEvent | ChatGlobalSessionTailEvent {
  return {
    scope: input.scope,
    sessionId: input.sessionId,
    sequenceId: input.sequenceId,
    version: input.version,
    type: 'SnapshotRequired',
    occurredAt: input.occurredAt,
    payload: {
      reason: 'tail_gap',
      latestVersion: input.version,
      latestSequenceId: input.sequenceId,
    },
  } as ChatSessionTailEvent | ChatGlobalSessionTailEvent
}

function encodeTailEvent(event: ChatSessionTailEvent | ChatGlobalSessionTailEvent): Uint8Array {
  return encoder.encode(
    `id: ${event.sequenceId}\nevent: ${event.scope}\ndata: ${JSON.stringify(event)}\n\n`,
  )
}

function readTailPayload(event: StoredChatSessionEvent): ChatSessionTailEvent['payload'] {
  switch (event.type) {
    case 'UserMessageAppended':
    case 'MessageImported':
    case 'SteerApplied':
      return { messageId: event.payload.message.id }
    case 'RunStarted':
      return {
        runId: event.payload.run.id,
        assistantMessageId: event.payload.assistantMessage?.id ?? event.payload.run.messageId ?? null,
        queueItemId: event.payload.queueItemId ?? null,
        ...(event.payload.runtimeSettings ? { runtimeSettings: event.payload.runtimeSettings } : {}),
      }
    case 'AssistantMessageCompleted':
      return {
        messageId: event.payload.message.id,
        status: event.payload.message.status,
      }
    case 'RunCompleted':
    case 'RunFailed':
    case 'RunAborted':
      return {
        runId: event.payload.runId,
        queueItemId: event.payload.queueItemId ?? null,
        bindingId: event.payload.bindingId ?? null,
        status: event.payload.status,
        stopReason: event.payload.stopReason,
        errorText: event.payload.errorText,
      }
    case 'InteractionRequested':
      return {
        runId: event.payload.runId,
        requestId: event.payload.requestId,
        interactionKind: event.payload.interactionKind,
        providerMethod: event.payload.providerMethod,
        toolCallId: event.payload.toolCallId,
        questionCount: event.payload.questionCount,
      }
    case 'InteractionResolved':
      return {
        runId: event.payload.runId,
        requestId: event.payload.requestId,
        interactionKind: event.payload.interactionKind,
        resolution: event.payload.resolution,
        approved: event.payload.approved,
      }
    case 'PlanImplementationResponded':
      return {
        messageId: event.payload.messageId,
        approvalId: event.payload.approvalId,
        approved: event.payload.approved,
      }
    case 'QueueItemEnqueued':
      return {
        queueItemId: event.payload.item.id,
        status: event.payload.item.status,
      }
    case 'QueueItemClaimed':
      return {
        queueItemId: event.payload.queueItemId,
        status: 'running',
        startedRunId: event.payload.startedRunId ?? null,
      }
    case 'QueueItemReleased':
      return {
        queueItemId: event.payload.queueItemId,
        status: 'pending',
      }
    case 'QueueItemFailed':
      return {
        queueItemId: event.payload.queueItemId,
        status: 'failed',
      }
    case 'QueueItemReordered':
      return {
        queueItemId: event.payload.queueItemId,
        position: event.payload.position,
      }
    case 'QueueItemUpdated':
    case 'QueueItemProviderTargetCleared':
      return {
        queueItemId: event.payload.queueItemId,
        updatedAt: event.payload.updatedAt,
      }
    case 'QueueItemCancelled':
      return {
        queueItemId: event.payload.queueItemId,
        status: 'cancelled',
      }
    case 'LastTurnRolledBack':
      return {
        messageIds: event.payload.messageIds,
        providerRuntimeKind: event.payload.providerRuntimeKind,
        providerSessionId: event.payload.providerSessionId,
        providerRolledBackTurns: event.payload.providerRolledBackTurns,
      }
    case 'TitleChanged':
      return {
        title: event.payload.title,
        titleSource: event.payload.titleSource,
      }
  }
}
