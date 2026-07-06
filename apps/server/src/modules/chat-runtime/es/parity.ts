import {
  backendRuns,
  chatSessionQueueItems,
  messages,
  type BackendRun,
  type ChatSessionQueueItem,
  type Message
} from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../../infra'
import { readSessionEvents } from './event-store'
import { projectSessionEvent } from './projectors'

export type ChatEsProjectionTable = 'messages' | 'backend_runs' | 'chat_session_queue_items'

export type ChatEsParityDiffKind =
  | 'extra_projection_row'
  | 'missing_projection_row'
  | 'changed_projection_row'

export type ChatEsParityClassification = 'expected_logless_write' | 'unexplained_drift'

export interface ChatEsParityDiff {
  table: ChatEsProjectionTable
  rowId: string
  kind: ChatEsParityDiffKind
  classification: ChatEsParityClassification
  category: string
  changedFields: string[]
  actual: ProjectionRow | null
  replayed: ProjectionRow | null
}

export interface ChatEsParityReport {
  sessionId: string
  eventsReplayed: number
  diffCount: number
  expectedLoglessDiffs: ChatEsParityDiff[]
  unexplainedDiffs: ChatEsParityDiff[]
  diffs: ChatEsParityDiff[]
}

type ProjectionRow = Message | BackendRun | ChatSessionQueueItem

interface ProjectionRows {
  messages: Message[]
  backend_runs: BackendRun[]
  chat_session_queue_items: ChatSessionQueueItem[]
}

class ProjectionReplayRollback extends Error {
  constructor(readonly rows: ProjectionRows) {
    super('Projection replay rollback')
  }
}

export function checkChatSessionProjectionParity(sessionId: string): ChatEsParityReport {
  const events = readSessionEvents(sessionId)
  const actualRows = readProjectionRows(sessionId)
  const replayedRows = replayProjectionRows(sessionId)
  const diffs = diffProjectionRows(actualRows, replayedRows)

  return {
    sessionId,
    eventsReplayed: events.length,
    diffCount: diffs.length,
    expectedLoglessDiffs: diffs.filter(diff => diff.classification === 'expected_logless_write'),
    unexplainedDiffs: diffs.filter(diff => diff.classification === 'unexplained_drift'),
    diffs
  }
}

function replayProjectionRows(sessionId: string): ProjectionRows {
  const events = readSessionEvents(sessionId)
  try {
    db().transaction((tx) => {
      tx.delete(chatSessionQueueItems)
        .where(eq(chatSessionQueueItems.sessionId, sessionId))
        .run()
      tx.delete(backendRuns)
        .where(eq(backendRuns.chatSessionId, sessionId))
        .run()
      tx.delete(messages)
        .where(eq(messages.sessionId, sessionId))
        .run()

      for (const event of events) {
        projectSessionEvent(tx, event)
      }

      throw new ProjectionReplayRollback(readProjectionRows(sessionId, tx))
    })
  } catch (error) {
    if (error instanceof ProjectionReplayRollback) {
      return error.rows
    }
    throw error
  }

  throw new Error('Projection replay transaction unexpectedly committed')
}

function readProjectionRows(
  sessionId: string,
  d: Pick<ReturnType<typeof db>, 'select'> = db()
): ProjectionRows {
  return {
    messages: d.select().from(messages).where(eq(messages.sessionId, sessionId)).all(),
    backend_runs: d.select().from(backendRuns).where(eq(backendRuns.chatSessionId, sessionId)).all(),
    chat_session_queue_items: d
      .select()
      .from(chatSessionQueueItems)
      .where(eq(chatSessionQueueItems.sessionId, sessionId))
      .all()
  }
}

function diffProjectionRows(actualRows: ProjectionRows, replayedRows: ProjectionRows): ChatEsParityDiff[] {
  return [
    ...diffTable('messages', actualRows.messages, replayedRows.messages),
    ...diffTable('backend_runs', actualRows.backend_runs, replayedRows.backend_runs),
    ...diffTable(
      'chat_session_queue_items',
      actualRows.chat_session_queue_items,
      replayedRows.chat_session_queue_items
    )
  ]
}

function diffTable(
  table: ChatEsProjectionTable,
  actualRows: ProjectionRow[],
  replayedRows: ProjectionRow[]
): ChatEsParityDiff[] {
  const actualById = rowsById(actualRows)
  const replayedById = rowsById(replayedRows)
  const rowIds = [...new Set([...actualById.keys(), ...replayedById.keys()])].sort()
  const diffs: ChatEsParityDiff[] = []

  for (const rowId of rowIds) {
    const actual = actualById.get(rowId) ?? null
    const replayed = replayedById.get(rowId) ?? null
    if (actual && !replayed) {
      diffs.push(classifyDiff({
        table,
        rowId,
        kind: 'extra_projection_row',
        changedFields: Object.keys(actual).sort(),
        actual,
        replayed
      }))
      continue
    }
    if (!actual && replayed) {
      diffs.push(classifyDiff({
        table,
        rowId,
        kind: 'missing_projection_row',
        changedFields: Object.keys(replayed).sort(),
        actual,
        replayed
      }))
      continue
    }
    if (!actual || !replayed) {
      continue
    }

    const changedFields = readChangedFields(actual, replayed)
    if (changedFields.length > 0) {
      diffs.push(classifyDiff({
        table,
        rowId,
        kind: 'changed_projection_row',
        changedFields,
        actual,
        replayed
      }))
    }
  }

  return diffs
}

function rowsById(rows: ProjectionRow[]): Map<string, ProjectionRow> {
  return new Map(rows.map(row => [row.id, row]))
}

function readChangedFields(actual: ProjectionRow, replayed: ProjectionRow): string[] {
  const fieldNames = new Set([...Object.keys(actual), ...Object.keys(replayed)])
  return [...fieldNames]
    .filter(fieldName => !Object.is(
      actual[fieldName as keyof ProjectionRow],
      replayed[fieldName as keyof ProjectionRow]
    ))
    .sort()
}

function classifyDiff(
  input: Omit<ChatEsParityDiff, 'classification' | 'category'>
): ChatEsParityDiff {
  return {
    ...input,
    classification: 'unexplained_drift',
    category: 'unexplained_projection_drift'
  }
}
