import type { BackendRunSnapshotEvent } from '@cradle/db'
import { backendRunSnapshotEvents } from '@cradle/db'
import { eq } from 'drizzle-orm'

import type { db } from '../../infra'
import { registerBeforeDatabaseShutdown } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { projectChatRuntimeRunSnapshotEventReadModels } from './read-model-projectors'

type SnapshotDatabase = ReturnType<typeof db>
export type SnapshotTransaction = Parameters<Parameters<SnapshotDatabase['transaction']>[0]>[0]

interface SnapshotEventUpdate {
  payloadJson: string
  occurredAt: number
  durationMs: number | null
}

interface SnapshotJournal {
  database: SnapshotDatabase
  pendingInserts: Map<string, BackendRunSnapshotEvent>
  pendingUpdates: Map<string, SnapshotEventUpdate>
  eventById: Map<string, BackendRunSnapshotEvent>
  workspaceBySnapshotId: Map<string, string | null>
  timer: ReturnType<typeof setTimeout> | null
}

const logger = createChildLogger({ module: 'chat-runtime.run-snapshot-journal' })
const journals = new Map<SnapshotDatabase, SnapshotJournal>()
const INSERT_BATCH_SIZE = 40
const FLUSH_DELAY_MS = 1_000
const RETRY_DELAY_MS = 1_000

registerBeforeDatabaseShutdown(() => {
  const failures: Error[] = []
  for (const journal of journals.values()) {
    cancelTimer(journal)
    try {
      flushJournal(journal)
    }
    catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
    finally {
      journals.delete(journal.database)
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to flush run snapshot journals')
  }
})

export function registerRunSnapshotContext(
  database: SnapshotDatabase,
  snapshotId: string,
  workspaceId: string | null,
): void {
  journalFor(database).workspaceBySnapshotId.set(snapshotId, workspaceId)
}

export function enqueueRunSnapshotEvent(
  database: SnapshotDatabase,
  event: BackendRunSnapshotEvent,
): void {
  const journal = journalFor(database)
  journal.pendingInserts.set(event.id, event)
  journal.eventById.set(event.id, event)
  scheduleFlush(journal, FLUSH_DELAY_MS)
}

export function updateQueuedRunSnapshotEvent(
  database: SnapshotDatabase,
  eventId: string,
  update: SnapshotEventUpdate,
): boolean {
  const journal = journals.get(database)
  const event = journal?.eventById.get(eventId)
  if (!journal || !event) {
    return false
  }
  const updatedEvent: BackendRunSnapshotEvent = { ...event, ...update }
  journal.eventById.set(eventId, updatedEvent)
  if (journal.pendingInserts.has(eventId)) {
    journal.pendingInserts.set(eventId, updatedEvent)
  }
  else {
    journal.pendingUpdates.set(eventId, update)
  }
  scheduleFlush(journal, FLUSH_DELAY_MS)
  return true
}

export function flushRunSnapshotJournalForSnapshot<Result>(
  database: SnapshotDatabase,
  snapshotId: string,
  withinTransaction?: (transaction: SnapshotTransaction) => Result,
): Result | undefined {
  const journal = journals.get(database)
  if (!journal) {
    return withinTransaction ? database.transaction(withinTransaction) : undefined
  }
  cancelTimer(journal)
  try {
    return flushJournal(journal, withinTransaction, snapshotId)
  }
  catch (error) {
    scheduleFlush(journal, RETRY_DELAY_MS)
    throw error
  }
}

export function flushRunSnapshotWriteBehind(): void {
  const failures: Error[] = []
  for (const journal of journals.values()) {
    cancelTimer(journal)
    try {
      flushJournal(journal)
    }
    catch (error) {
      scheduleFlush(journal, RETRY_DELAY_MS)
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to flush run snapshot journals')
  }
}

export function releaseRunSnapshotContext(database: SnapshotDatabase, snapshotId: string): void {
  const journal = journals.get(database)
  if (!journal) {
    return
  }
  journal.workspaceBySnapshotId.delete(snapshotId)
  for (const [eventId, event] of journal.eventById) {
    if (event.snapshotId === snapshotId) {
      journal.eventById.delete(eventId)
    }
  }
  removeJournalIfIdle(journal)
}

function journalFor(database: SnapshotDatabase): SnapshotJournal {
  let journal = journals.get(database)
  if (!journal) {
    journal = {
      database,
      pendingInserts: new Map(),
      pendingUpdates: new Map(),
      eventById: new Map(),
      workspaceBySnapshotId: new Map(),
      timer: null,
    }
    journals.set(database, journal)
  }
  return journal
}

function scheduleFlush(journal: SnapshotJournal, delayMs: number): void {
  if (journal.timer) {
    return
  }
  journal.timer = setTimeout(() => {
    journal.timer = null
    try {
      flushJournal(journal)
    }
    catch (error) {
      logger.error('failed to flush run snapshot journal', { error })
      scheduleFlush(journal, RETRY_DELAY_MS)
    }
  }, delayMs)
  journal.timer.unref?.()
}

function flushJournal<Result>(
  journal: SnapshotJournal,
  withinTransaction?: (transaction: SnapshotTransaction) => Result,
  snapshotId?: string,
): Result | undefined {
  const inserts = [...journal.pendingInserts.values()]
    .filter(event => snapshotId === undefined || event.snapshotId === snapshotId)
  const updates = [...journal.pendingUpdates.entries()]
    .filter(([eventId]) =>
      snapshotId === undefined || journal.eventById.get(eventId)?.snapshotId === snapshotId)
  let result: Result | undefined
  journal.database.transaction((tx) => {
    for (let offset = 0; offset < inserts.length; offset += INSERT_BATCH_SIZE) {
      tx.insert(backendRunSnapshotEvents)
        .values(inserts.slice(offset, offset + INSERT_BATCH_SIZE))
        .run()
    }
    for (const [eventId, update] of updates) {
      tx.update(backendRunSnapshotEvents)
        .set(update)
        .where(eq(backendRunSnapshotEvents.id, eventId))
        .run()
    }
    for (const event of inserts) {
      projectChatRuntimeRunSnapshotEventReadModels(tx, {
        sourceEvent: event,
        workspaceId: journal.workspaceBySnapshotId.get(event.snapshotId) ?? null,
      })
    }
    for (const [eventId] of updates) {
      const event = journal.eventById.get(eventId)
      if (event) {
        projectChatRuntimeRunSnapshotEventReadModels(tx, {
          sourceEvent: event,
          workspaceId: journal.workspaceBySnapshotId.get(event.snapshotId) ?? null,
        })
      }
    }
    result = withinTransaction?.(tx)
  })
  for (const event of inserts) {
    journal.pendingInserts.delete(event.id)
  }
  for (const [eventId] of updates) {
    journal.pendingUpdates.delete(eventId)
  }
  if (journal.pendingInserts.size > 0 || journal.pendingUpdates.size > 0) {
    scheduleFlush(journal, FLUSH_DELAY_MS)
  }
  removeJournalIfIdle(journal)
  return result
}

function removeJournalIfIdle(journal: SnapshotJournal): void {
  if (
    journal.pendingInserts.size === 0
    && journal.pendingUpdates.size === 0
    && journal.workspaceBySnapshotId.size === 0
  ) {
    cancelTimer(journal)
    journals.delete(journal.database)
  }
}

function cancelTimer(journal: SnapshotJournal): void {
  if (!journal.timer) {
    return
  }
  clearTimeout(journal.timer)
  journal.timer = null
}
