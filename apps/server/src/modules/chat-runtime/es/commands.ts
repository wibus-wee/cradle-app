import type { BackendRun, ChatSessionQueueItem, Message } from '@cradle/db'
import {
  backendRunSnapshots,
  backendRuns,
  chatSessionQueueItems,
  messages,
  sessionEvents
} from '@cradle/db'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'

import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import { parseStoredMessageSnapshot } from '../ui-message'
import type { ChatMessageStatus } from '../run/stream-chunks'
import { appendSessionEvent } from './event-store'
import type {
  ChatSessionEvent,
  QueueProjectionStatus,
  StoredChatSessionEvent,
  TerminalRunEventType
} from './events'
import { parseStoredChatSessionEvent } from './events'
import { projectSessionEvent } from './projectors'
import { runSessionActorTask } from './session-actor'

const INTERRUPTED_RUN_STOP_REASON = 'response.interrupted'
const INTERRUPTED_RUN_ERROR_TEXT =
  'Response interrupted because the Cradle server process exited while the run was streaming.'
const RECOVERY_BATCH_SIZE = 100

export interface ChatRuntimeRecoveryResult {
  interruptedRunsFinalized: number
  terminalFactsProjected: number
  terminalProjectionDriftsRepaired: number
}

export function commitSessionEvents(sessionId: string, events: ChatSessionEvent[]): Promise<void> {
  if (events.length === 0) {
    return Promise.resolve()
  }
  return runSessionActorTask(sessionId, () => {
    commitSessionEventsInTransaction(sessionId, events)
  })
}

function commitSessionEventsInTransaction(sessionId: string, events: ChatSessionEvent[]): void {
  db().transaction((tx) => {
    for (const event of events) {
      const stored = appendSessionEvent(tx, {
        aggregateId: sessionId,
        event
      })
      projectSessionEvent(tx, stored)
    }
  })
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
  return await runSessionActorTask(sessionId, () => {
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
        return undefined
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
        ...row,
        status: 'running',
        errorText: null,
        updatedAt
      }
    })
  })
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
  return await runSessionActorTask(sessionId, () => {
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
        return 0
      }

      const updatedAt = currentUnixSeconds()
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
      }
      return rows.length
    })
  })
}

export async function normalizeSessionQueuePositions(sessionId: string): Promise<number> {
  return await runSessionActorTask(sessionId, () => {
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
        changed += 1
      })
      return changed
    })
  })
}

export async function cancelQueuedSessionItem(
  sessionId: string,
  queueItemId: string
): Promise<ChatSessionQueueItem | undefined> {
  return await runSessionActorTask(sessionId, () => {
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
        return row
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
        ...row,
        status: 'cancelled',
        errorText: null,
        updatedAt
      }
    })
  })
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

export async function recoverChatRuntimeProjections(): Promise<ChatRuntimeRecoveryResult> {
  return {
    interruptedRunsFinalized: await finalizeInterruptedSessionEventStreams(),
    terminalFactsProjected: await projectTerminalRunFacts(),
    terminalProjectionDriftsRepaired: await repairTerminalProjectionDrifts()
  }
}

export async function recoverChatRuntimeSession(
  sessionId: string
): Promise<ChatRuntimeRecoveryResult> {
  return {
    interruptedRunsFinalized: await finalizeInterruptedRunsForSession(sessionId),
    terminalFactsProjected: await projectTerminalRunFactsForSession(sessionId),
    terminalProjectionDriftsRepaired: await repairTerminalProjectionDrifts(sessionId)
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
  return await runSessionActorTask(run.chatSessionId, () =>
    projectTerminalRunFactInActor(run.chatSessionId, run.id)
  )
}

function projectTerminalRunFactInActor(sessionId: string, runId: string): boolean {
  const run = readRun(sessionId, runId)
  if (!run || run.status === 'streaming') {
    return false
  }
  if (hasTerminalRunFact(sessionId, run.id)) {
    return false
  }
  const message = run.messageId ? readMessage(run.chatSessionId, run.messageId) : null
  const finishedAt = run.finishedAt ?? currentUnixSeconds()
  const events: ChatSessionEvent[] = []
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
          updatedAt: finishedAt
        }
      }
    })
  }
  events.push({
    type: readRunTerminalEventType(run.status),
    payload: {
      runId: run.id,
      sessionId: run.chatSessionId,
      queueItemId: readRunQueueItemId(run.chatSessionId, run.id),
      ...(run.bindingId !== null ? { bindingId: run.bindingId } : {}),
      status: run.status,
      stopReason: run.stopReason ?? readRunStopReason(run.status),
      errorText: run.errorText,
      finishedAt
    }
  })
  commitSessionEventsInTransaction(run.chatSessionId, events)
  return true
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
    repairTerminalProjectionDriftInActor(sessionId, runId)
  )
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

    const snapshot = tx
      .select()
      .from(backendRunSnapshots)
      .where(eq(backendRunSnapshots.runId, run.id))
      .get()
    if (snapshot && snapshot.status !== terminalFact.payload.status) {
      tx.update(backendRunSnapshots)
        .set({
          status: terminalFact.payload.status,
          completedAt: terminalFact.payload.finishedAt * 1000,
          completionReason: terminalFact.payload.stopReason,
          errorText: terminalFact.payload.errorText
        })
        .where(eq(backendRunSnapshots.id, snapshot.id))
        .run()
      repaired = true
    }
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
          terminalRunFactEventPredicate()
        )
      )
      .limit(1)
      .get() !== undefined
  )
}

export async function finalizeInterruptedRun(sessionId: string, runId: string): Promise<boolean> {
  return await runSessionActorTask(sessionId, () => finalizeInterruptedRunInActor(sessionId, runId))
}

function finalizeInterruptedRunInActor(sessionId: string, runId: string): boolean {
  const run = readRun(sessionId, runId)
  if (!run || run.status !== 'streaming') {
    return false
  }

  const message = run.messageId ? readMessage(sessionId, run.messageId) : null
  const finishedAt = currentUnixSeconds()
  const events: ChatSessionEvent[] = []
  if (message) {
    events.push({
      type: 'AssistantMessageCompleted',
      payload: {
        message: {
          id: message.id,
          sessionId,
          content: message.content,
          messageJson: normalizeTerminalMessageJson(message),
          status: 'failed',
          errorText: INTERRUPTED_RUN_ERROR_TEXT,
          updatedAt: finishedAt
        }
      }
    })
  }
  events.push({
    type: 'RunFailed',
    payload: {
      runId,
      sessionId,
      queueItemId: readRunQueueItemId(sessionId, runId),
      ...(run.bindingId !== null ? { bindingId: run.bindingId } : {}),
      status: 'failed',
      stopReason: INTERRUPTED_RUN_STOP_REASON,
      errorText: INTERRUPTED_RUN_ERROR_TEXT,
      finishedAt
    }
  })
  commitSessionEventsInTransaction(sessionId, events)
  return true
}

export async function abortProjectedStreamingRun(run: BackendRun): Promise<boolean> {
  return await runSessionActorTask(run.chatSessionId, () =>
    abortProjectedStreamingRunInActor(run.chatSessionId, run.id)
  )
}

function abortProjectedStreamingRunInActor(sessionId: string, runId: string): boolean {
  const run = readRun(sessionId, runId)
  if (!run || run.status !== 'streaming') {
    return false
  }
  const finishedAt = currentUnixSeconds()
  const message = run.messageId ? readMessage(run.chatSessionId, run.messageId) : null
  const events: ChatSessionEvent[] = []
  if (message) {
    events.push({
      type: 'AssistantMessageCompleted',
      payload: {
        message: {
          id: message.id,
          sessionId: run.chatSessionId,
          content: message.content,
          messageJson: normalizeTerminalMessageJson(message),
          status: 'aborted',
          errorText: null,
          updatedAt: finishedAt
        }
      }
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
      finishedAt
    }
  })
  commitSessionEventsInTransaction(run.chatSessionId, events)
  return true
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
  limit: number
): BackendRun[] {
  const predicate = sessionId
    ? and(
        eq(backendRuns.chatSessionId, sessionId),
        terminalRunStatusPredicate(),
        missingTerminalRunFactPredicate()
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
  limit: number
): BackendRun[] {
  const predicate = sessionId
    ? and(
        eq(backendRuns.chatSessionId, sessionId),
        terminalRunStatusPredicate(),
        hasTerminalRunFactPredicate(),
        terminalProjectionDriftPredicate()
      )
    : and(
        terminalRunStatusPredicate(),
        hasTerminalRunFactPredicate(),
        terminalProjectionDriftPredicate()
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
      finishedAt: backendRuns.finishedAt
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
    eq(backendRuns.status, 'failed')
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
      sql`${backendRunSnapshots.status} != ${backendRuns.status}`
    )
  )
}

function readTerminalRunFact(
  sessionId: string,
  runId: string
): Extract<StoredChatSessionEvent, { type: TerminalRunEventType }> | undefined {
  const row = db()
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.aggregateId, sessionId),
        eq(sessionEvents.subjectRunId, runId),
        terminalRunFactEventPredicate()
      )
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
  maxVersion: number
): Extract<StoredChatSessionEvent, { type: 'AssistantMessageCompleted' }> | undefined {
  const row = db()
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.aggregateId, sessionId),
        eq(sessionEvents.eventType, 'AssistantMessageCompleted'),
        sql`${sessionEvents.version} <= ${maxVersion}`,
        sql`json_extract(${sessionEvents.payload}, '$.message.id') = ${messageId}`
      )
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
          eq(chatSessionQueueItems.startedRunId, runId)
        )
      )
      .get()?.id ?? null
  )
}

function normalizeTerminalMessageJson(message: Message): string {
  try {
    const parsed = parseStoredMessageSnapshot(message.messageJson)
    return JSON.stringify(parsed)
  } catch {
    return message.messageJson
  }
}
