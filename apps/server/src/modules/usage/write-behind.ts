import { stepUsage, usageLogs } from '@cradle/db'

import { db, registerBeforeDatabaseShutdown } from '../../infra'
import { createChildLogger } from '../../logging/logger'

type UsageDatabase = ReturnType<typeof db>
type UsageLogInsert = typeof usageLogs.$inferInsert
type StepUsageInsert = typeof stepUsage.$inferInsert

interface UsageWriteJournal {
  database: UsageDatabase
  usageRows: UsageLogInsert[]
  stepRows: StepUsageInsert[]
  timer: ReturnType<typeof setTimeout> | null
}

const logger = createChildLogger({ module: 'usage.write-behind' })
const journals = new Map<UsageDatabase, UsageWriteJournal>()
const INSERT_BATCH_SIZE = 50
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
    throw new AggregateError(failures, 'Failed to flush usage write-behind journals')
  }
})

export function enqueueUsageLog(row: UsageLogInsert): void {
  const journal = currentJournal()
  journal.usageRows.push(row)
  scheduleFlush(journal, 0)
}

export function enqueueStepUsage(rows: StepUsageInsert[]): void {
  if (rows.length === 0) {
    return
  }
  const journal = currentJournal()
  journal.stepRows.push(...rows)
  scheduleFlush(journal, 0)
}

/** Read-your-writes boundary for Usage APIs and graceful shutdown. */
export function flushUsageWriteBehind(): void {
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
    throw new AggregateError(failures, 'Failed to flush usage write-behind journals')
  }
}

function currentJournal(): UsageWriteJournal {
  const database = db()
  let journal = journals.get(database)
  if (!journal) {
    journal = { database, usageRows: [], stepRows: [], timer: null }
    journals.set(database, journal)
  }
  return journal
}

function scheduleFlush(journal: UsageWriteJournal, delayMs: number): void {
  if (journal.timer) {
    return
  }
  journal.timer = setTimeout(() => {
    journal.timer = null
    try {
      flushJournal(journal)
    }
    catch (error) {
      logger.error('failed to flush usage write-behind journal', { error })
      scheduleFlush(journal, RETRY_DELAY_MS)
    }
  }, delayMs)
  journal.timer.unref?.()
}

function flushJournal(journal: UsageWriteJournal): void {
  if (journal.usageRows.length === 0 && journal.stepRows.length === 0) {
    journals.delete(journal.database)
    return
  }

  const usageCount = journal.usageRows.length
  const stepCount = journal.stepRows.length
  journal.database.transaction((tx) => {
    for (let offset = 0; offset < usageCount; offset += INSERT_BATCH_SIZE) {
      tx.insert(usageLogs)
        .values(journal.usageRows.slice(offset, Math.min(offset + INSERT_BATCH_SIZE, usageCount)))
        .run()
    }
    for (let offset = 0; offset < stepCount; offset += INSERT_BATCH_SIZE) {
      tx.insert(stepUsage)
        .values(journal.stepRows.slice(offset, Math.min(offset + INSERT_BATCH_SIZE, stepCount)))
        .run()
    }
  })
  journal.usageRows.splice(0, usageCount)
  journal.stepRows.splice(0, stepCount)
  if (journal.usageRows.length === 0 && journal.stepRows.length === 0) {
    journals.delete(journal.database)
  }
  else {
    scheduleFlush(journal, 0)
  }
}

function cancelTimer(journal: UsageWriteJournal): void {
  if (!journal.timer) {
    return
  }
  clearTimeout(journal.timer)
  journal.timer = null
}
