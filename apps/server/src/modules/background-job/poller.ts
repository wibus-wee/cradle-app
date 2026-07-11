import * as BackgroundJob from './service'

const DEFAULT_INTERVAL_MS = 2_000

let timer: ReturnType<typeof setInterval> | null = null
let running = false
let runScheduled = false
let rerunRequested = false

export function start(): void {
  if (timer) {
    return
  }
  timer = setInterval(requestRun, DEFAULT_INTERVAL_MS)
  timer.unref?.()
  requestRun()
}

export function stop(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  runScheduled = false
  rerunRequested = false
}

export function requestRun(): void {
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
    await BackgroundJob.reconcile({ limit: 100 })
  }
 finally {
    running = false
    if (rerunRequested) {
      rerunRequested = false
      requestRun()
    }
  }
}
