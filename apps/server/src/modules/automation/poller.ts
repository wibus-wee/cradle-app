import * as Automation from './service'

const DEFAULT_INTERVAL_MS = 30_000

let timer: ReturnType<typeof setInterval> | null = null
let running = false

export async function pollDueAutomations(input: { now?: number, execute?: boolean } = {}) {
  const runs = Automation.enqueueDueRuns({ now: input.now })
  if (input.execute === false) {
    return runs
  }

  for (const run of runs) {
    void Automation.executeRun(run.id)
  }
  return runs
}

export function start(): void {
  if (timer) {
    return
  }

  timer = setInterval(() => {
    if (running) {
      return
    }
    running = true
    void pollDueAutomations().finally(() => {
      running = false
    })
  }, DEFAULT_INTERVAL_MS)
}

export function stop(): void {
  if (!timer) {
    return
  }

  clearInterval(timer)
  timer = null
  running = false
}
