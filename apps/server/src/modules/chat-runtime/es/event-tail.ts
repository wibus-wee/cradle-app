import type {
  ChatGlobalSessionTailEvent,
  ChatSessionTailEvent,
  ChatSessionTailMessageSnapshot,
} from '@cradle/chat-runtime-contracts'
import { messages, sessionEvents, sessions } from '@cradle/db'
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm'

import { db } from '../../../infra'
import { readMessagePayloads } from '../message-payload-store'
import { parseStoredMessageSnapshot } from '../ui-message'
import { publishChatRunActivities } from './activity-tail'
import type {
  ChatSessionEventRow,
  ChatSessionHeaderEvent,
  MessageRecordedFact,
  StoredChatSessionEvent,
} from './events'
import {
  isLegacyAssistantMessageSnapshottedRow,
  parseChatSessionEventHeader,
  parseStoredChatSessionEvent,
} from './events'

const encoder = new TextEncoder()
const DEFAULT_TAIL_LIMIT = 500
const KEEPALIVE_INTERVAL_MS = 15000
const TAIL_STREAM_MAX_EVENTS = 128
const TAIL_STREAM_MAX_BYTES = 1024 * 1024

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

interface TailMessageStructure {
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
}

export function toChatSessionTailEvent(
  event: StoredChatSessionEvent,
  messageStructuresById?: ReadonlyMap<string, TailMessageStructure>,
): ChatSessionTailEvent {
  return {
    scope: 'session',
    sessionId: event.aggregateId,
    sequenceId: event.sequenceId,
    version: event.version,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: readTailPayload(event, messageStructuresById),
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

  const eventRows = rows.filter(row => !isLegacyAssistantMessageSnapshottedRow(row))
  const headers = eventRows.map(parseChatSessionEventHeader)
  const payloads = readMessagePayloads(db(), headers.flatMap(readHeaderMessagePayloadIds))
  const messageStructures = readTailMessageStructures(headers.flatMap(readCompletedMessageIds))
  const events = eventRows.map(row => toChatSessionTailEvent(
    parseStoredChatSessionEvent(row, payloadId => payloads.get(payloadId)),
    messageStructures,
  ))
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
    .map(toGlobalTailEventFromRow)
  return {
    events,
    cursor: events.at(-1)?.sequenceId ?? input.afterSequenceId,
    snapshotRequired: null,
  }
}

export function publishSessionTailEvents(events: StoredChatSessionEvent[]): void {
  const workspaceIdsBySessionId = readWorkspaceIdsBySessionId(events)
  const messageStructures = sessionSubscribers.size > 0
    ? readTailMessageStructures(events.flatMap(event =>
        event.type === 'AssistantMessageCompleted' ? [event.payload.message.id] : []))
    : new Map<string, TailMessageStructure>()
  for (const stored of events) {
    const subscribers = sessionSubscribers.get(stored.aggregateId)
    if (subscribers) {
      const event = toChatSessionTailEvent(stored, messageStructures)
      for (const subscriber of subscribers) {
        subscriber(event)
      }
    }
    if (globalSubscribers.size > 0) {
      const event = toHeaderOnlySessionTailEventFromStored(stored)
      const workspaceId = workspaceIdsBySessionId.get(event.sessionId) ?? null
      for (const subscriber of globalSubscribers) {
        subscriber({ event, workspaceId })
      }
    }
  }
  publishChatRunActivities(events)
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
    subscriber(toGlobalTailEvent(event))
  }
  globalSubscribers.add(wrapped)
  return () => {
    globalSubscribers.delete(wrapped)
  }
}

function readWorkspaceIdsBySessionId(events: StoredChatSessionEvent[]): Map<string, string | null> {
  const sessionIds = [...new Set(events.map(event => event.aggregateId))]
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

function readTailMessageStructures(
  messageIds: readonly string[],
): Map<string, TailMessageStructure> {
  const uniqueMessageIds = [...new Set(messageIds)]
  if (uniqueMessageIds.length === 0) {
    return new Map()
  }
  const rows = db()
    .select({
      id: messages.id,
      parentMessageId: messages.parentMessageId,
      parentToolCallId: messages.parentToolCallId,
      taskId: messages.taskId,
      depth: messages.depth,
    })
    .from(messages)
    .where(inArray(messages.id, uniqueMessageIds))
    .all()
  return new Map(rows.map(row => [row.id, row]))
}

export function openTailStream<TEvent extends ChatSessionTailEvent | ChatGlobalSessionTailEvent>(input: {
  replay: ChatTailReplay<TEvent>
  subscribe: (subscriber: (event: TEvent) => void) => () => void
  readCatchupReplay: (cursor: number) => ChatTailReplay<TEvent>
}): ReadableStream<Uint8Array> {
  let unsubscribe = () => {}
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let closed = false
  let accepting = true
  let terminalAfterDrain = false
  const pending: Uint8Array[] = []
  let pendingBytes = 0
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null

  const stopProducer = () => {
    if (!accepting) {
      return
    }
    accepting = false
    unsubscribe()
    unsubscribe = () => {}
    if (keepAlive) {
      clearInterval(keepAlive)
      keepAlive = null
    }
  }
  const close = () => {
    if (closed) {
      return
    }
    closed = true
    stopProducer()
    pending.length = 0
    pendingBytes = 0
  }
  const drain = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    pullRequested = false,
  ) => {
    if (closed) {
      return
    }
    while (
      pending.length > 0
      && (pullRequested || (controller.desiredSize ?? 0) > 0)
    ) {
      const chunk = pending.shift()!
      pendingBytes -= chunk.byteLength
      controller.enqueue(chunk)
      pullRequested = false
    }
    if (!closed && terminalAfterDrain && pending.length === 0) {
      closed = true
      controller.close()
    }
  }

  const replaceWithSnapshotRequired = (event: TEvent) => {
    stopProducer()
    pending.length = 0
    pendingBytes = 0
    const snapshotRequired = createTailSnapshotRequiredEvent(event) as TEvent
    const chunk = encodeTailEvent(snapshotRequired)
    pending.push(chunk)
    pendingBytes = chunk.byteLength
    terminalAfterDrain = true
    if (controllerRef) {
      drain(controllerRef)
    }
  }

  const enqueueEvent = (event: TEvent) => {
    if (!accepting || closed) {
      return
    }
    const chunk = encodeTailEvent(event)
    if (
      pending.length + 1 > TAIL_STREAM_MAX_EVENTS
      || pendingBytes + chunk.byteLength > TAIL_STREAM_MAX_BYTES
    ) {
      replaceWithSnapshotRequired(event)
      return
    }
    pending.push(chunk)
    pendingBytes += chunk.byteLength
    if (controllerRef) {
      drain(controllerRef)
    }
  }

  const enqueueReplay = (replay: ChatTailReplay<TEvent>): boolean => {
    for (const event of replay.events) {
      enqueueEvent(event)
      if (!accepting) {
        const latest = replay.events.at(-1)
        if (latest && latest !== event) {
          replaceWithSnapshotRequired(latest)
        }
        return false
      }
    }
    if (replay.snapshotRequired) {
      stopProducer()
      const chunk = encodeTailEvent(replay.snapshotRequired)
      pending.push(chunk)
      pendingBytes += chunk.byteLength
      terminalAfterDrain = true
      return false
    }
    return true
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
      if (!enqueueReplay(input.replay)) {
        drain(controller)
        return
      }
      unsubscribe = input.subscribe(enqueueEvent)
      const catchup = input.readCatchupReplay(input.replay.cursor)
      if (!enqueueReplay(catchup)) {
        drain(controller)
        return
      }
      keepAlive = setInterval(() => {
        if (closed || !accepting || pending.length > 0) {
          return
        }
        const chunk = encoder.encode(': keepalive\n\n')
        if (pendingBytes + chunk.byteLength > TAIL_STREAM_MAX_BYTES) {
          close()
          return
        }
        pending.push(chunk)
        pendingBytes += chunk.byteLength
        drain(controller)
      }, KEEPALIVE_INTERVAL_MS)
      drain(controller)
    },
    pull(controller) {
      drain(controller, true)
    },
    cancel() {
      close()
    },
  }, { highWaterMark: 0 })
}

export function readTailStreamBufferLimits(): { maxEvents: number, maxBytes: number } {
  return {
    maxEvents: TAIL_STREAM_MAX_EVENTS,
    maxBytes: TAIL_STREAM_MAX_BYTES,
  }
}

function createTailSnapshotRequiredEvent(
  event: ChatSessionTailEvent | ChatGlobalSessionTailEvent,
): ChatSessionTailEvent | ChatGlobalSessionTailEvent {
  const cursor = {
    sessionId: event.sessionId,
    sequenceId: event.sequenceId,
    version: event.version,
    occurredAt: event.occurredAt,
  }
  return event.scope === 'session'
    ? toChatTailSnapshotRequiredEvent({ scope: 'session', ...cursor })
    : toChatTailSnapshotRequiredEvent({ scope: 'sessions', ...cursor })
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

const TAIL_PREVIEW_MAX_CHARS = 2_000

function toTailMessageSnapshot(fact: MessageRecordedFact): ChatSessionTailMessageSnapshot | null {
  try {
    const message = parseStoredMessageSnapshot(fact.messageJson)
    if (message.role !== 'user' && message.role !== 'assistant') {
      return null
    }
    return {
      messageId: fact.id,
      role: message.role,
      status: fact.status,
      ...(fact.errorText ? { errorText: fact.errorText } : {}),
      preview: fact.content.slice(0, TAIL_PREVIEW_MAX_CHARS),
      previewTruncated: fact.content.length > TAIL_PREVIEW_MAX_CHARS,
      parentMessageId: fact.parentMessageId,
      parentToolCallId: fact.parentToolCallId,
      taskId: fact.taskId,
      depth: fact.depth,
      message,
    }
  }
  catch {
    // Snapshot enrichment is best-effort: clients fall back to a snapshot
    // refetch when a message event arrives without an inline snapshot.
    return null
  }
}

function toCompletedTailMessageSnapshot(payload: {
  id: string
  content: string
  messageJson: string
  status: ChatSessionTailMessageSnapshot['status']
  errorText: string | null
}, messageStructuresById?: ReadonlyMap<string, TailMessageStructure>): ChatSessionTailMessageSnapshot | null {
  try {
    const structural = messageStructuresById
      ? messageStructuresById.get(payload.id)
      : db()
          .select({
            parentMessageId: messages.parentMessageId,
            parentToolCallId: messages.parentToolCallId,
            taskId: messages.taskId,
            depth: messages.depth,
          })
          .from(messages)
          .where(eq(messages.id, payload.id))
          .get()
    if (!structural) {
      return null
    }
    const message = parseStoredMessageSnapshot(payload.messageJson)
    if (message.role !== 'user' && message.role !== 'assistant') {
      return null
    }
    return {
      messageId: payload.id,
      role: message.role,
      status: payload.status,
      ...(payload.errorText ? { errorText: payload.errorText } : {}),
      preview: payload.content.slice(0, TAIL_PREVIEW_MAX_CHARS),
      previewTruncated: payload.content.length > TAIL_PREVIEW_MAX_CHARS,
      parentMessageId: structural.parentMessageId,
      parentToolCallId: structural.parentToolCallId,
      taskId: structural.taskId,
      depth: structural.depth,
      message,
    }
  }
  catch {
    return null
  }
}

/** Global-scope tails stay slim: strip inline message snapshots before fan-out. */
function stripTailMessageSnapshots(payload: ChatSessionTailEvent['payload']): ChatSessionTailEvent['payload'] {
  if ('snapshot' in payload || 'assistantSnapshot' in payload) {
    const { snapshot: _snapshot, assistantSnapshot: _assistantSnapshot, ...slim } = payload as
      ChatSessionTailEvent['payload'] & {
        snapshot?: ChatSessionTailMessageSnapshot
        assistantSnapshot?: ChatSessionTailMessageSnapshot
      }
    return slim
  }
  return payload
}

function readHeaderMessagePayloadIds(event: ChatSessionHeaderEvent): string[] {
  switch (event.type) {
    case 'UserMessageAppended':
    case 'MessageImported':
    case 'SteerApplied':
      return [event.payload.message.payloadId]
    case 'RunStarted':
      return event.payload.assistantMessage ? [event.payload.assistantMessage.payloadId] : []
    case 'AssistantMessageCompleted':
      return [event.payload.message.payloadId]
    default:
      return []
  }
}

function readCompletedMessageIds(event: ChatSessionHeaderEvent): string[] {
  return event.type === 'AssistantMessageCompleted' ? [event.payload.message.id] : []
}

function toHeaderOnlySessionTailEventFromStored(
  event: StoredChatSessionEvent,
): ChatSessionTailEvent {
  return {
    scope: 'session',
    sessionId: event.aggregateId,
    sequenceId: event.sequenceId,
    version: event.version,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: readHeaderOnlyTailPayload(event),
  }
}

function toGlobalTailEventFromStored(event: StoredChatSessionEvent): ChatGlobalSessionTailEvent {
  return {
    ...toHeaderOnlySessionTailEventFromStored(event),
    scope: 'sessions',
  }
}

function toGlobalTailEventFromRow(row: ChatSessionEventRow): ChatGlobalSessionTailEvent {
  const header = parseChatSessionEventHeader(row)
  const base = {
    scope: 'sessions' as const,
    sessionId: row.aggregateId,
    sequenceId: row.sequenceId,
    version: row.version,
    type: header.type,
    occurredAt: row.occurredAt,
  }
  switch (header.type) {
    case 'UserMessageAppended':
    case 'MessageImported':
    case 'SteerApplied':
      return { ...base, payload: { messageId: header.payload.message.id } }
    case 'RunStarted': {
      const storedPayload = JSON.parse(row.payload) as { runtimeSettings?: Record<string, unknown> }
      return {
        ...base,
        payload: {
          runId: header.payload.run.id,
          assistantMessageId: header.payload.assistantMessage?.id ?? header.payload.run.messageId ?? null,
          queueItemId: header.payload.queueItemId,
          ...(storedPayload.runtimeSettings ? { runtimeSettings: storedPayload.runtimeSettings } : {}),
        },
      } as ChatGlobalSessionTailEvent
    }
    case 'AssistantMessageCompleted':
      return {
        ...base,
        payload: {
          messageId: header.payload.message.id,
          status: header.payload.message.status,
        },
      }
    default:
      return toGlobalTailEventFromStored(parseStoredChatSessionEvent(row))
  }
}

function readHeaderOnlyTailPayload(
  event: StoredChatSessionEvent,
): ChatSessionTailEvent['payload'] {
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
    default:
      return stripTailMessageSnapshots(readTailPayload(event))
  }
}

function toGlobalTailEvent(event: ChatSessionTailEvent): ChatGlobalSessionTailEvent {
  return {
    ...event,
    scope: 'sessions',
    payload: stripTailMessageSnapshots(event.payload),
  }
}

function encodeTailEvent(event: ChatSessionTailEvent | ChatGlobalSessionTailEvent): Uint8Array {
  return encoder.encode(
    `id: ${event.sequenceId}\nevent: ${event.scope}\ndata: ${JSON.stringify(event)}\n\n`,
  )
}

function readTailPayload(
  event: StoredChatSessionEvent,
  messageStructuresById?: ReadonlyMap<string, TailMessageStructure>,
): ChatSessionTailEvent['payload'] {
  switch (event.type) {
    case 'UserMessageAppended':
    case 'MessageImported':
    case 'SteerApplied': {
      const snapshot = toTailMessageSnapshot(event.payload.message)
      return {
        messageId: event.payload.message.id,
        ...(snapshot ? { snapshot } : {}),
      }
    }
    case 'RunStarted': {
      const assistantSnapshot = event.payload.assistantMessage
        ? toTailMessageSnapshot(event.payload.assistantMessage)
        : null
      return {
        runId: event.payload.run.id,
        assistantMessageId: event.payload.assistantMessage?.id ?? event.payload.run.messageId ?? null,
        queueItemId: event.payload.queueItemId ?? null,
        ...(event.payload.runtimeSettings ? { runtimeSettings: event.payload.runtimeSettings } : {}),
        ...(assistantSnapshot ? { assistantSnapshot } : {}),
      }
    }
    case 'AssistantMessageCompleted': {
      const snapshot = toCompletedTailMessageSnapshot(event.payload.message, messageStructuresById)
      return {
        messageId: event.payload.message.id,
        status: event.payload.message.status,
        ...(snapshot ? { snapshot } : {}),
      }
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
    case 'QueueItemCompleted':
      return {
        queueItemId: event.payload.queueItemId,
        status: 'completed',
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
