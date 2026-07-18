import * as service from './service'
import type { CheckResult, SessionAwait, SessionAwaitSource } from './types'

const DEFAULT_HEAVY_CONCURRENCY = 3

interface HeavyCheckJob {
  adapter: SessionAwaitSource
  row: SessionAwait
}

const queue: HeavyCheckJob[] = []
const queuedIds = new Set<string>()
const inFlightIds = new Set<string>()
const idleWaiters: Array<() => void> = []

let active = 0
let concurrency = DEFAULT_HEAVY_CONCURRENCY

export function setHeavyCheckConcurrency(value: number): void {
  concurrency = Math.max(1, value)
}

export function isHeavyCheckInFlight(awaitId: string): boolean {
  return inFlightIds.has(awaitId) || queuedIds.has(awaitId)
}

function isDue(row: SessionAwait, intervalMs: number, nowSeconds: number): boolean {
  if (row.lastCheckedAt === null) {
    return true
  }
  return (nowSeconds - row.lastCheckedAt) * 1000 >= intervalMs
}

function notifyIdle(): void {
  if (active > 0 || queue.length > 0) {
    return
  }
  const waiters = idleWaiters.splice(0)
  for (const resolve of waiters) {
    resolve()
  }
}

export async function applyCheckResults(
  adapter: SessionAwaitSource,
  results: CheckResult[],
  options?: { triggerLimit?: (fn: () => Promise<unknown>) => Promise<unknown> },
): Promise<void> {
  const EMPTY_RESUME_TEXT_ERROR = 'Source adapter matched without a resume message'
  const toTrigger: { awaitId: string, resumeText: string, resumePayloadJson?: string }[] = []

  for (const result of results) {
    if (result.matched) {
      if (result.resumeText.trim().length === 0) {
        const failed = service.markFailed(result.awaitId, EMPTY_RESUME_TEXT_ERROR)
        if (failed && adapter.resumeOnFailure) {
          await service.resumeFailedAwait(failed, EMPTY_RESUME_TEXT_ERROR)
        }
      }
      else {
        toTrigger.push({
          awaitId: result.awaitId,
          resumeText: result.resumeText,
          resumePayloadJson: result.resumePayloadJson,
        })
      }
      continue
    }

    if (result.permanentError) {
      const failed = service.markFailed(
        result.awaitId,
        result.permanentError,
        result.incrementErrorCount,
      )
      if (failed && adapter.resumeOnFailure) {
        await service.resumeFailedAwait(failed, result.permanentError)
      }
      continue
    }

    if (adapter.tracksConsecutiveErrors) {
      service.recordTrackedEvaluationCheck(result.awaitId, result.transientError)
    }
    else {
      service.updateLastChecked(result.awaitId, result.transientError)
    }
  }

  if (toTrigger.length === 0) {
    return
  }

  if (options?.triggerLimit) {
    await Promise.all(toTrigger.map(item => options.triggerLimit!(() => service.trigger(item))))
    return
  }

  await Promise.all(toTrigger.map(item => service.trigger(item)))
}

async function runJob(job: HeavyCheckJob): Promise<void> {
  try {
    const results = await job.adapter.checkPending([job.row])
    await applyCheckResults(job.adapter, results)
  }
  catch {
    if (job.adapter.tracksConsecutiveErrors) {
      service.recordTrackedEvaluationCheck(job.row.id, 'Source adapter threw')
    }
    else {
      service.updateLastChecked(job.row.id, 'Source adapter threw')
    }
  }
}

function pump(): void {
  while (active < concurrency && queue.length > 0) {
    const job = queue.shift()!
    queuedIds.delete(job.row.id)
    if (inFlightIds.has(job.row.id)) {
      continue
    }
    inFlightIds.add(job.row.id)
    active++
    void runJob(job).finally(() => {
      inFlightIds.delete(job.row.id)
      active--
      pump()
      notifyIdle()
    })
  }
  notifyIdle()
}

export function enqueueHeavyChecks(
  adapter: SessionAwaitSource,
  rows: SessionAwait[],
  intervalMs: number,
): void {
  const nowSeconds = Math.floor(Date.now() / 1000)
  for (const row of rows) {
    if (inFlightIds.has(row.id) || queuedIds.has(row.id)) {
      continue
    }
    if (!isDue(row, intervalMs, nowSeconds)) {
      continue
    }
    queuedIds.add(row.id)
    queue.push({ adapter, row })
  }
  pump()
}

/** Resolves when the heavy-check queue has no queued or in-flight work. */
export function flushHeavyCheckQueue(): Promise<void> {
  if (active === 0 && queue.length === 0) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    idleWaiters.push(resolve)
  })
}

export function clearHeavyCheckQueue(): void {
  queue.length = 0
  queuedIds.clear()
}
