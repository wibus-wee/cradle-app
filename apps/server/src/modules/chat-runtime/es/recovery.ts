import type { BackendRun, ChatSessionQueueItem, Message, RunStreamCheckpoint } from '@cradle/db'
import {
  backendRuns,
  backendRunSnapshots,
  chatSessionQueueItems,
  messages,
  runStreamCheckpoints,
  sessionEvents,
} from '@cradle/db'
import { and, desc, eq, or, sql } from 'drizzle-orm'

import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import {
  deleteRunStreamCheckpoint,
  readRunStreamCheckpoint,
} from '../stream/checkpoint-store'
import { extractMessageText, parseStoredMessageSnapshot } from '../ui-message'
import {
  appendDecidedSessionEvents,
  readRunStopReason,
  readRunTerminalEventType,
} from './commands'
import { publishSessionTailEvents } from './event-tail'
import type { ChatSessionEvent, StoredChatSessionEvent, TerminalRunEventType } from './events'
import { parseStoredChatSessionEvent } from './events'
import { projectSessionEvent } from './projectors'
import { runSessionActorTask } from './session-actor'

const INTERRUPTED_RUN_STOP_REASON = 'response.interrupted'
const INTERRUPTED_RUN_ERROR_TEXT
  = 'Response interrupted because the Cradle server process exited while the run was streaming.'
const RECOVERY_BATCH_SIZE = 100

export interface ChatRuntimeRecoveryResult {
  interruptedRunsFinalized: number
  terminalFactsProjected: number
  terminalProjectionDriftsRepaired: number
}

export async function recoverChatRuntimeProjections(): Promise<ChatRuntimeRecoveryResult> {
  deleteStaleTerminalRunCheckpoints()
  return {
    interruptedRunsFinalized: await finalizeInterruptedSessionEventStreams(),
    terminalFactsProjected: await projectTerminalRunFacts(),
    terminalProjectionDriftsRepaired: await repairTerminalProjectionDrifts(),
  }
}

export async function recoverChatRuntimeSession(
  sessionId: string,
): Promise<ChatRuntimeRecoveryResult> {
  deleteStaleTerminalRunCheckpoints(sessionId)
  return {
    interruptedRunsFinalized: await finalizeInterruptedRunsForSession(sessionId),
    terminalFactsProjected: await projectTerminalRunFactsForSession(sessionId),
    terminalProjectionDriftsRepaired: await repairTerminalProjectionDrifts(sessionId),
  }
}

export async function finalizeInterruptedSessionEventStreams(): Promise<number> {
  return await finalizeInterruptedRunsForSession()
}

async function finalizeInterruptedRunsForSession(sessionId?: string): Promise<number> {
  let recovered = 0
  let batch = readStreamingRuns(sessionId, RECOVERY_BATCH_SIZE)
  while (batch.length > 0) {
    for (const run of batch) {
      if (await finalizeInterruptedRun(run.chatSessionId, run.id)) {
        recovered += 1
      }
    }
    batch = readStreamingRuns(sessionId, RECOVERY_BATCH_SIZE)
  }
  return recovered
}

export async function finalizeInterruptedSessionEventStream(sessionId: string): Promise<boolean> {
  return (await finalizeInterruptedRunsForSession(sessionId)) > 0
}

export async function projectTerminalRunFacts(): Promise<number> {
  let count = 0
  let batch = readTerminalRunsMissingTerminalFact(undefined, RECOVERY_BATCH_SIZE)
  while (batch.length > 0) {
    for (const run of batch) {
      if (await projectTerminalRunFact(run)) {
        count += 1
      }
    }
    batch = readTerminalRunsMissingTerminalFact(undefined, RECOVERY_BATCH_SIZE)
  }
  return count
}

export async function projectTerminalRunFactsForSession(sessionId: string): Promise<number> {
  let count = 0
  let batch = readTerminalRunsMissingTerminalFact(sessionId, RECOVERY_BATCH_SIZE)
  while (batch.length > 0) {
    for (const run of batch) {
      if (await projectTerminalRunFact(run)) {
        count += 1
      }
    }
    batch = readTerminalRunsMissingTerminalFact(sessionId, RECOVERY_BATCH_SIZE)
  }
  return count
}

export async function projectTerminalRunFact(run: BackendRun): Promise<boolean> {
  const storedEvents = await runSessionActorTask(run.chatSessionId, () =>
    projectTerminalRunFactInActor(run.chatSessionId, run.id))
  publishSessionTailEvents(storedEvents)
  return storedEvents.length > 0
}

function projectTerminalRunFactInActor(sessionId: string, runId: string): StoredChatSessionEvent[] {
  const run = readRun(sessionId, runId)
  if (!run || run.status === 'streaming') {
    return []
  }
  if (hasTerminalRunFact(sessionId, run.id)) {
    return []
  }
  const message = run.messageId ? readMessage(run.chatSessionId, run.messageId) : null
  const finishedAt = run.finishedAt ?? currentUnixSeconds()
  const queueItemId = readRunQueueItemId(run.chatSessionId, run.id)
  const bootstrapEvents = readMissingRunBootstrapEvents({ run, message, queueItemId })
  const events: ChatSessionEvent[] = [...bootstrapEvents]
  if (message) {
    events.push({
      type: 'AssistantMessageCompleted',
      payload: {
        message: {
          id: message.id,
          sessionId: run.chatSessionId,
          content: message.content,
          messageJson: normalizeTerminalMessageJson(message),
          status: run.status,
          errorText: run.errorText,
          updatedAt: finishedAt,
        },
      },
    })
  }
  events.push({
    type: readRunTerminalEventType(run.status),
    payload: {
      runId: run.id,
      sessionId: run.chatSessionId,
      queueItemId,
      ...(run.bindingId !== null ? { bindingId: run.bindingId } : {}),
      status: run.status,
      stopReason: run.stopReason ?? readRunStopReason(run.status),
      errorText: run.errorText,
      finishedAt,
    },
  })
  return commitRecoverySessionEventsInTransaction(run.chatSessionId, {
    events,
    alreadyProjectedCount: bootstrapEvents.length,
    afterAppend: (tx) => {
      deleteRunStreamCheckpoint(run.id, tx)
    },
  })
}

export async function repairTerminalProjectionDrifts(sessionId?: string): Promise<number> {
  let repaired = 0
  let batch = readTerminalProjectionDriftRuns(sessionId, RECOVERY_BATCH_SIZE)
  while (batch.length > 0) {
    for (const run of batch) {
      if (await repairTerminalProjectionDrift(run.chatSessionId, run.id)) {
        repaired += 1
      }
    }
    batch = readTerminalProjectionDriftRuns(sessionId, RECOVERY_BATCH_SIZE)
  }
  return repaired
}

async function repairTerminalProjectionDrift(sessionId: string, runId: string): Promise<boolean> {
  return await runSessionActorTask(sessionId, () =>
    repairTerminalProjectionDriftInActor(sessionId, runId))
}

function repairTerminalProjectionDriftInActor(sessionId: string, runId: string): boolean {
  const run = readRun(sessionId, runId)
  if (!run || run.status === 'streaming') {
    return false
  }

  const terminalFact = readTerminalRunFact(sessionId, run.id)
  if (!terminalFact) {
    return false
  }
  const assistantFact = run.messageId
    ? readAssistantMessageCompletedFact(sessionId, run.messageId, terminalFact.version)
    : undefined

  let repaired = false
  db().transaction((tx) => {
    if (run.messageId) {
      const message = tx
        .select()
        .from(messages)
        .where(and(eq(messages.id, run.messageId), eq(messages.sessionId, sessionId)))
        .get()
      if (message?.status === 'streaming' && assistantFact) {
        projectSessionEvent(tx, assistantFact)
        repaired = true
      }
    }

    projectSessionEvent(tx, terminalFact)
    repaired = true
  })

  return repaired
}

function hasTerminalRunFact(sessionId: string, runId: string): boolean {
  return (
    db()
      .select({ sequenceId: sessionEvents.sequenceId })
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.aggregateId, sessionId),
          eq(sessionEvents.subjectRunId, runId),
          terminalRunFactEventPredicate(),
        ),
      )
      .limit(1)
      .get() !== undefined
  )
}

function hasRunStartedFact(sessionId: string, runId: string): boolean {
  return (
    db()
      .select({ sequenceId: sessionEvents.sequenceId })
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.aggregateId, sessionId),
          eq(sessionEvents.subjectRunId, runId),
          eq(sessionEvents.eventType, 'RunStarted'),
        ),
      )
      .limit(1)
      .get() !== undefined
  )
}

function hasQueueItemEnqueuedFact(sessionId: string, queueItemId: string): boolean {
  return (
    db()
      .select({ sequenceId: sessionEvents.sequenceId })
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.aggregateId, sessionId),
          eq(sessionEvents.eventType, 'QueueItemEnqueued'),
          sql`json_extract(${sessionEvents.payload}, '$.item.id') = ${queueItemId}`,
        ),
      )
      .limit(1)
      .get() !== undefined
  )
}

export async function finalizeInterruptedRun(sessionId: string, runId: string): Promise<boolean> {
  const storedEvents = await runSessionActorTask(sessionId, () =>
    finalizeInterruptedRunInActor(sessionId, runId))
  publishSessionTailEvents(storedEvents)
  return storedEvents.length > 0
}

function finalizeInterruptedRunInActor(sessionId: string, runId: string): StoredChatSessionEvent[] {
  const run = readRun(sessionId, runId)
  if (!run || run.status !== 'streaming') {
    return []
  }

  const checkpoint = readRunStreamCheckpoint(runId)
  const message = run.messageId ? readMessage(sessionId, run.messageId) : null
  const finishedAt = currentUnixSeconds()
  const queueItemId = readRunQueueItemId(sessionId, runId)
  const bootstrapEvents = readMissingRunBootstrapEvents({ run, message, queueItemId })
  const events: ChatSessionEvent[] = [...bootstrapEvents]
  const completedMessage = readInterruptedAssistantMessage({
    sessionId,
    run,
    message,
    checkpoint,
    finishedAt,
  })
  if (completedMessage) {
    events.push({
      type: 'AssistantMessageCompleted',
      payload: {
        message: completedMessage,
      },
    })
  }
  events.push({
    type: 'RunFailed',
    payload: {
      runId,
      sessionId,
      queueItemId,
      ...(run.bindingId !== null ? { bindingId: run.bindingId } : {}),
      status: 'failed',
      stopReason: INTERRUPTED_RUN_STOP_REASON,
      errorText: INTERRUPTED_RUN_ERROR_TEXT,
      finishedAt,
    },
  })
  return commitRecoverySessionEventsInTransaction(sessionId, {
    events,
    alreadyProjectedCount: bootstrapEvents.length,
    afterAppend: (tx) => {
      deleteRunStreamCheckpoint(runId, tx)
    },
  })
}

function readInterruptedAssistantMessage(input: {
  sessionId: string
  run: BackendRun
  message: Message | null | undefined
  checkpoint: RunStreamCheckpoint | undefined
  finishedAt: number
}): {
  id: string
  sessionId: string
  content: string
  messageJson: string
  status: 'failed'
  errorText: string
  updatedAt: number
} | null {
  const messageId = input.checkpoint?.messageId ?? input.run.messageId ?? input.message?.id
  if (!messageId) {
    return null
  }

  const messageJson = input.checkpoint
    ? input.checkpoint.messageJson
    : input.message
      ? normalizeTerminalMessageJson(input.message)
      : JSON.stringify({ id: messageId, role: 'assistant', parts: [] })
  let content = input.message?.content ?? ''
  try {
    content = extractMessageText(parseStoredMessageSnapshot(messageJson))
  }
 catch {
    // Keep projection content when checkpoint JSON is malformed.
  }

  return {
    id: messageId,
    sessionId: input.sessionId,
    content,
    messageJson,
    status: 'failed',
    errorText: INTERRUPTED_RUN_ERROR_TEXT,
    updatedAt: input.finishedAt,
  }
}

function commitRecoverySessionEventsInTransaction(
  sessionId: string,
  input: {
    events: ChatSessionEvent[]
    alreadyProjectedCount: number
    afterAppend?: (tx: Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]) => void
  },
): StoredChatSessionEvent[] {
  if (input.events.length === 0) {
    return []
  }

  const storedEvents: StoredChatSessionEvent[] = []
  db().transaction((tx) => {
    let appended = 0
    storedEvents.push(
      ...appendDecidedSessionEvents(tx, sessionId, input.events, {
        projectEvent: () => {
          appended += 1
          return appended > input.alreadyProjectedCount
        },
      }),
    )
    input.afterAppend?.(tx)
  })
  return storedEvents
}

function deleteStaleTerminalRunCheckpoints(sessionId?: string): void {
  const predicate = sessionId
    ? and(
        eq(runStreamCheckpoints.sessionId, sessionId),
        sql`exists (
          select 1
          from ${sessionEvents}
          where ${sessionEvents.aggregateId} = ${runStreamCheckpoints.sessionId}
            and ${sessionEvents.subjectRunId} = ${runStreamCheckpoints.runId}
            and ${sessionEvents.eventType} in ('RunCompleted', 'RunFailed', 'RunAborted')
        )`,
      )
    : sql`exists (
        select 1
        from ${sessionEvents}
        where ${sessionEvents.aggregateId} = ${runStreamCheckpoints.sessionId}
          and ${sessionEvents.subjectRunId} = ${runStreamCheckpoints.runId}
          and ${sessionEvents.eventType} in ('RunCompleted', 'RunFailed', 'RunAborted')
      )`

  db().delete(runStreamCheckpoints).where(predicate).run()
}

function readMissingRunBootstrapEvents(input: {
  run: BackendRun
  message: Message | null | undefined
  queueItemId: string | null
}): ChatSessionEvent[] {
  if (hasRunStartedFact(input.run.chatSessionId, input.run.id)) {
    return []
  }

  const queueItem = input.queueItemId
    ? readQueueItem(input.run.chatSessionId, input.queueItemId)
    : undefined
  const events: ChatSessionEvent[] = []
  if (queueItem && !hasQueueItemEnqueuedFact(input.run.chatSessionId, queueItem.id)) {
    events.push({
      type: 'QueueItemEnqueued',
      payload: {
        item: {
          id: queueItem.id,
          sessionId: queueItem.sessionId,
          mode: 'queue',
          status: 'pending',
          text: queueItem.text,
          filesJson: queueItem.filesJson,
          contextPartsJson: queueItem.contextPartsJson,
          providerTargetId: queueItem.providerTargetId,
          modelId: queueItem.modelId,
          thinkingEffort: queueItem.thinkingEffort,
          runtimeSettingsJson: queueItem.runtimeSettingsJson,
          position: queueItem.position,
          sourceRunId: queueItem.sourceRunId,
          startedRunId: null,
          errorText: null,
          createdAt: queueItem.createdAt,
          updatedAt: queueItem.createdAt,
        },
      },
    })
  }

  events.push({
    type: 'RunStarted',
    payload: {
      run: {
        id: input.run.id,
        bindingId: input.run.bindingId,
        chatSessionId: input.run.chatSessionId,
        messageId: input.run.messageId,
        origin: input.run.origin,
        status: 'streaming',
        stopReason: null,
        errorText: null,
        startedAt: input.run.startedAt,
        finishedAt: null,
      },
      assistantMessage:
        input.message?.role === 'assistant'
          ? {
              id: input.message.id,
              sessionId: input.message.sessionId,
              parentMessageId: input.message.parentMessageId,
              parentToolCallId: input.message.parentToolCallId,
              taskId: input.message.taskId,
              depth: input.message.depth,
              role: 'assistant',
              status: 'streaming',
              content: input.message.content,
              messageJson: normalizeTerminalMessageJson(input.message),
              errorText: null,
              createdAt: input.message.createdAt,
              updatedAt: input.run.startedAt,
            }
          : null,
      queueItemId: queueItem?.id ?? null,
    },
  })
  return events
}

export async function abortProjectedStreamingRun(run: BackendRun): Promise<boolean> {
  const storedEvents = await runSessionActorTask(run.chatSessionId, () =>
    abortProjectedStreamingRunInActor(run.chatSessionId, run.id))
  publishSessionTailEvents(storedEvents)
  return storedEvents.length > 0
}

function abortProjectedStreamingRunInActor(
  sessionId: string,
  runId: string,
): StoredChatSessionEvent[] {
  const run = readRun(sessionId, runId)
  if (!run || run.status !== 'streaming') {
    return []
  }
  const finishedAt = currentUnixSeconds()
  const checkpoint = readRunStreamCheckpoint(runId)
  const message = run.messageId ? readMessage(run.chatSessionId, run.messageId) : null
  const events: ChatSessionEvent[] = []
  const completedMessage = readInterruptedAssistantMessage({
    sessionId: run.chatSessionId,
    run,
    message,
    checkpoint,
    finishedAt,
  })
  if (completedMessage) {
    events.push({
      type: 'AssistantMessageCompleted',
      payload: {
        message: {
          ...completedMessage,
          status: 'aborted',
          errorText: null,
        },
      },
    })
  }
  events.push({
    type: 'RunAborted',
    payload: {
      runId: run.id,
      sessionId: run.chatSessionId,
      queueItemId: readRunQueueItemId(run.chatSessionId, run.id),
      ...(run.bindingId !== null ? { bindingId: run.bindingId } : {}),
      status: 'aborted',
      stopReason: 'response.cancelled',
      errorText: null,
      finishedAt,
    },
  })
  const storedEvents: StoredChatSessionEvent[] = []
  db().transaction((tx) => {
    storedEvents.push(...appendDecidedSessionEvents(tx, run.chatSessionId, events))
    deleteRunStreamCheckpoint(runId, tx)
  })
  return storedEvents
}

function readRun(sessionId: string, runId: string): BackendRun | undefined {
  return db()
    .select()
    .from(backendRuns)
    .where(and(eq(backendRuns.id, runId), eq(backendRuns.chatSessionId, sessionId)))
    .get()
}

function readStreamingRuns(sessionId?: string, limit = RECOVERY_BATCH_SIZE): BackendRun[] {
  const predicate = sessionId
    ? and(eq(backendRuns.chatSessionId, sessionId), eq(backendRuns.status, 'streaming'))
    : eq(backendRuns.status, 'streaming')
  return db()
    .select()
    .from(backendRuns)
    .where(predicate)
    .orderBy(backendRuns.startedAt, backendRuns.id)
    .limit(limit)
    .all()
}

function readTerminalRunsMissingTerminalFact(
  sessionId: string | undefined,
  limit: number,
): BackendRun[] {
  const predicate = sessionId
    ? and(
        eq(backendRuns.chatSessionId, sessionId),
        terminalRunStatusPredicate(),
        missingTerminalRunFactPredicate(),
      )
    : and(terminalRunStatusPredicate(), missingTerminalRunFactPredicate())

  return db()
    .select()
    .from(backendRuns)
    .where(predicate)
    .orderBy(backendRuns.startedAt, backendRuns.id)
    .limit(limit)
    .all()
}

function readTerminalProjectionDriftRuns(
  sessionId: string | undefined,
  limit: number,
): BackendRun[] {
  const predicate = sessionId
    ? and(
        eq(backendRuns.chatSessionId, sessionId),
        terminalRunStatusPredicate(),
        hasTerminalRunFactPredicate(),
        terminalProjectionDriftPredicate(),
      )
    : and(
        terminalRunStatusPredicate(),
        hasTerminalRunFactPredicate(),
        terminalProjectionDriftPredicate(),
      )

  return db()
    .selectDistinct({
      id: backendRuns.id,
      bindingId: backendRuns.bindingId,
      chatSessionId: backendRuns.chatSessionId,
      messageId: backendRuns.messageId,
      origin: backendRuns.origin,
      status: backendRuns.status,
      stopReason: backendRuns.stopReason,
      errorText: backendRuns.errorText,
      startedAt: backendRuns.startedAt,
      finishedAt: backendRuns.finishedAt,
    })
    .from(backendRuns)
    .leftJoin(messages, eq(messages.id, backendRuns.messageId))
    .leftJoin(backendRunSnapshots, eq(backendRunSnapshots.runId, backendRuns.id))
    .where(predicate)
    .orderBy(backendRuns.startedAt, backendRuns.id)
    .limit(limit)
    .all()
}

function terminalRunStatusPredicate() {
  return or(
    eq(backendRuns.status, 'complete'),
    eq(backendRuns.status, 'aborted'),
    eq(backendRuns.status, 'failed'),
  )
}

function terminalRunFactEventPredicate() {
  return sql`${sessionEvents.eventType} in ('RunCompleted', 'RunFailed', 'RunAborted')`
}

function missingTerminalRunFactPredicate() {
  return sql`not exists (
    select 1
    from ${sessionEvents}
    where ${sessionEvents.aggregateId} = ${backendRuns.chatSessionId}
      and ${sessionEvents.subjectRunId} = ${backendRuns.id}
      and ${sessionEvents.eventType} in ('RunCompleted', 'RunFailed', 'RunAborted')
  )`
}

function hasTerminalRunFactPredicate() {
  return sql`exists (
    select 1
    from ${sessionEvents}
    where ${sessionEvents.aggregateId} = ${backendRuns.chatSessionId}
      and ${sessionEvents.subjectRunId} = ${backendRuns.id}
      and ${sessionEvents.eventType} in ('RunCompleted', 'RunFailed', 'RunAborted')
  )`
}

function terminalProjectionDriftPredicate() {
  return or(
    eq(messages.status, 'streaming'),
    and(
      sql`${backendRunSnapshots.id} is not null`,
      sql`${backendRunSnapshots.status} != ${backendRuns.status}`,
    ),
  )
}

function readTerminalRunFact(
  sessionId: string,
  runId: string,
): Extract<StoredChatSessionEvent, { type: TerminalRunEventType }> | undefined {
  const row = db()
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.aggregateId, sessionId),
        eq(sessionEvents.subjectRunId, runId),
        terminalRunFactEventPredicate(),
      ),
    )
    .limit(1)
    .get()
  return row
    ? (parseStoredChatSessionEvent(row) as Extract<
        StoredChatSessionEvent,
        { type: TerminalRunEventType }
      >)
    : undefined
}

function readAssistantMessageCompletedFact(
  sessionId: string,
  messageId: string,
  maxVersion: number,
): Extract<StoredChatSessionEvent, { type: 'AssistantMessageCompleted' }> | undefined {
  const row = db()
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.aggregateId, sessionId),
        eq(sessionEvents.eventType, 'AssistantMessageCompleted'),
        sql`${sessionEvents.version} <= ${maxVersion}`,
        sql`json_extract(${sessionEvents.payload}, '$.message.id') = ${messageId}`,
      ),
    )
    .orderBy(desc(sessionEvents.version))
    .limit(1)
    .get()
  return row
    ? (parseStoredChatSessionEvent(row) as Extract<
        StoredChatSessionEvent,
        { type: 'AssistantMessageCompleted' }
      >)
    : undefined
}

function readMessage(sessionId: string, messageId: string): Message | undefined {
  return db()
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.sessionId, sessionId)))
    .get()
}

function readRunQueueItemId(sessionId: string, runId: string): string | null {
  return (
    db()
      .select({ id: chatSessionQueueItems.id })
      .from(chatSessionQueueItems)
      .where(
        and(
          eq(chatSessionQueueItems.sessionId, sessionId),
          eq(chatSessionQueueItems.mode, 'queue'),
          eq(chatSessionQueueItems.startedRunId, runId),
        ),
      )
      .get()
?.id ?? null
  )
}

function readQueueItem(
  sessionId: string,
  queueItemId: string,
): ChatSessionQueueItem | undefined {
  return db()
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
}

function normalizeTerminalMessageJson(message: Message): string {
  try {
    const parsed = parseStoredMessageSnapshot(message.messageJson)
    return JSON.stringify(parsed)
  }
 catch {
    return message.messageJson
  }
}
