import * as service from './service'
import type { SessionAwaitSource } from './types'

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
const EMPTY_RESUME_TEXT_ERROR = 'Source adapter matched without a resume message'

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

    // 3. Source-based checks
    for (const [sourceName, adapter] of sourceAdapters) {
      const pending = service.listPendingBySource(sourceName).slice(0, MAX_CHECKS_PER_SOURCE)
      if (pending.length === 0) {
        continue
      }

      let results: Awaited<ReturnType<SessionAwaitSource['checkPending']>>
      try {
        results = await adapter.checkPending(pending)
      }
      catch {
        // Mark all as checked with transient error
        for (const row of pending) {
          service.updateLastChecked(row.id, 'Source adapter threw')
        }
        continue
      }

      const toTrigger: { awaitId: string, resumeText: string, resumePayloadJson?: string }[] = []
      for (const result of results) {
        if (result.matched) {
          if (result.resumeText.trim().length === 0) {
            service.markFailed(result.awaitId, EMPTY_RESUME_TEXT_ERROR)
          }
          else {
            toTrigger.push({ awaitId: result.awaitId, resumeText: result.resumeText, resumePayloadJson: result.resumePayloadJson })
          }
        }
        else if (result.permanentError) {
          service.markFailed(result.awaitId, result.permanentError)
        }
        else if (result.transientError) {
          service.updateLastChecked(result.awaitId, result.transientError)
        }
        else {
          service.updateLastChecked(result.awaitId)
        }
      }

      // Trigger matched awaits with concurrency limit
      await Promise.all(
        toTrigger.map(t => limit(() => service.trigger(t))),
      )
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

async function tick() {
  await runOnce()
}
