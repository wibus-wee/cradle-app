import {
  applyCheckResults,
  clearHeavyCheckQueue,
  enqueueHeavyChecks,
  flushHeavyCheckQueue,
} from './heavy-check-queue'
import * as service from './service'
import type { SessionAwaitSource } from './types'

export { flushHeavyCheckQueue } from './heavy-check-queue'

// ── Simple concurrency limiter ──

function pLimit(concurrency: number) {
  let active = 0
  const queue: (() => void)[] = []
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++
        fn().then(resolve, reject).finally(() => {
          active--
          if (queue.length > 0) {
            queue.shift()!()
          }
        })
      }
      if (active < concurrency) {
        run()
      }
      else {
        queue.push(run)
      }
    })
}

// ── Source adapter registry ──

const sourceAdapters = new Map<string, SessionAwaitSource>()

export function registerSource(adapter: SessionAwaitSource) {
  sourceAdapters.set(adapter.source, adapter)
}

export function unregisterSource(source: string) {
  sourceAdapters.delete(source)
}

// ── Poller ──

const DEFAULT_INTERVAL_MS = 30_000
const MAX_CONCURRENT_TRIGGERS = 3
const MAX_CHECKS_PER_SOURCE = 100

let timer: ReturnType<typeof setInterval> | null = null
let running = false
let runScheduled = false
let rerunRequested = false

export function start() {
  if (timer) {
    return
  }
  timer = setInterval(() => void tick(), DEFAULT_INTERVAL_MS)
  requestRun()
}

export function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  clearHeavyCheckQueue()
}

export function requestRun() {
  if (running) {
    rerunRequested = true
    return
  }
  if (runScheduled) {
    return
  }

  runScheduled = true
  queueMicrotask(() => {
    runScheduled = false
    void runOnce()
  })
}

export async function runOnce(): Promise<void> {
  if (running) {
    rerunRequested = true
    return
  }
  running = true
  try {
    const now = Math.floor(Date.now() / 1000)

    // 1. Auto-expire past-due awaits
    let allPending: ReturnType<typeof service.listAllPending>
    try {
      allPending = service.listAllPending()
    }
    catch {
      // Table may not exist yet (migration pending) — skip this cycle
      return
    }
    for (const row of allPending) {
      if (row.expiresAt !== null && row.expiresAt <= now) {
        service.expire(row.id)
      }
    }

    // 2. Timer-based triggers (fireAt <= now)
    const limit = pLimit(MAX_CONCURRENT_TRIGGERS)
    const timerAwaits = service.listAllPending().filter(r => r.fireAt !== null && r.fireAt <= now)
    await Promise.all(
      timerAwaits.map(row => limit(() =>
        service.trigger({ awaitId: row.id, resumeText: 'Timer fired' }))),
    )

    // 3. Source-based checks — inline sources run on the poller path; queued
    //    (heavy) sources are only enqueued so they cannot block github-ci etc.
    for (const [sourceName, adapter] of sourceAdapters) {
      const pending = service.listPendingBySource(sourceName).slice(0, MAX_CHECKS_PER_SOURCE)
      if (pending.length === 0) {
        continue
      }

      if ((adapter.execution ?? 'inline') === 'queued') {
        enqueueHeavyChecks(
          adapter,
          pending,
          adapter.pollIntervalMs ?? DEFAULT_INTERVAL_MS,
        )
        continue
      }

      let results: Awaited<ReturnType<SessionAwaitSource['checkPending']>>
      try {
        results = await adapter.checkPending(pending)
      }
      catch {
        for (const row of pending) {
          if (adapter.tracksConsecutiveErrors) {
            service.recordTrackedEvaluationCheck(row.id, 'Source adapter threw')
          }
          else {
            service.updateLastChecked(row.id, 'Source adapter threw')
          }
        }
        continue
      }

      await applyCheckResults(adapter, results, { triggerLimit: limit })
    }
  }
  finally {
    running = false
    if (rerunRequested) {
      rerunRequested = false
      requestRun()
    }
  }
}

/** Test helper: one poller cycle plus drain of any queued heavy checks. */
export async function runOnceAndFlush(): Promise<void> {
  await runOnce()
  await flushHeavyCheckQueue()
}

async function tick() {
  await runOnce()
}
