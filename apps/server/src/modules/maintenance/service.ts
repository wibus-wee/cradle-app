import type {
  BackgroundActivityPriority,
  BackgroundActivityProgress,
} from '../background-activity/service'
import * as BackgroundActivity from '../background-activity/service'

export interface MaintenanceRunContext {
  now: number
  deadline: number
  source: BackgroundActivity.BackgroundActivityRunSource
  report: (progress: BackgroundActivityProgress | null) => void
  presentInFooter: BackgroundActivity.BackgroundActivityReporter['presentInFooter']
}

export type MaintenanceResult = BackgroundActivityProgress

export interface MaintenanceTaskDescriptor {
  ownerNamespace: string
  key: string
  title: string
  priority?: BackgroundActivityPriority
  intervalMs: number | null
  runOnStart: boolean
  manuallyRunnable: boolean
  maxRunMs?: number
  run: (context: MaintenanceRunContext) => Promise<MaintenanceResult> | MaintenanceResult
}

interface MaintenanceTaskRecord {
  descriptor: MaintenanceTaskDescriptor
  timer: ReturnType<typeof setTimeout> | null
}

const DEFAULT_MAX_RUN_MS = 30_000
const MAX_JITTER_MS = 5 * 60 * 1000
const tasks = new Map<string, MaintenanceTaskRecord>()
let started = false

function taskId(ownerNamespace: string, key: string): string {
  return `${ownerNamespace}\u0000${key}`
}

function trigger(descriptor: MaintenanceTaskDescriptor): string {
  return descriptor.intervalMs === null ? 'manual maintenance' : 'scheduled maintenance'
}

function registerActivity(descriptor: MaintenanceTaskDescriptor): void {
  BackgroundActivity.register({
    ownerNamespace: descriptor.ownerNamespace,
    key: descriptor.key,
    title: descriptor.title,
    priority: descriptor.priority ?? 'low',
    trigger: trigger(descriptor),
    manuallyRunnable: descriptor.manuallyRunnable,
    async run(reporter, activityContext) {
      const now = Date.now()
      const result = await descriptor.run({
        now,
        deadline: now + (descriptor.maxRunMs ?? DEFAULT_MAX_RUN_MS),
        source: activityContext.source,
        report: reporter.report,
        presentInFooter: reporter.presentInFooter,
      })
      reporter.report({ ...result, completed: true })
    },
  })
}

export function registerTask(descriptor: MaintenanceTaskDescriptor): void {
  const id = taskId(descriptor.ownerNamespace, descriptor.key)
  const existing = tasks.get(id)
  if (existing?.timer) {
    clearTimeout(existing.timer)
  }
  const record: MaintenanceTaskRecord = { descriptor, timer: null }
  tasks.set(id, record)
  registerActivity(descriptor)
  if (started) {
    startTask(record)
  }
}

export function start(): void {
  if (started) {
    return
  }
  started = true
  for (const record of tasks.values()) {
    startTask(record)
  }
}

export function stop(): void {
  started = false
  for (const record of tasks.values()) {
    if (record.timer) {
      clearTimeout(record.timer)
      record.timer = null
    }
  }
}

export function reset(): void {
  stop()
  for (const record of tasks.values()) {
    BackgroundActivity.unregister(record.descriptor.ownerNamespace, record.descriptor.key)
  }
  tasks.clear()
}

function startTask(record: MaintenanceTaskRecord): void {
  if (record.descriptor.runOnStart) {
    queueMicrotask(() => {
      if (
        started
        && tasks.get(taskId(record.descriptor.ownerNamespace, record.descriptor.key)) === record
      ) {
        void BackgroundActivity.requestRun(record.descriptor.ownerNamespace, record.descriptor.key)
      }
    })
  }
  scheduleNext(record)
}

function scheduleNext(record: MaintenanceTaskRecord): void {
  const { intervalMs } = record.descriptor
  if (!started || intervalMs === null) {
    return
  }
  const delay = intervalMs + stableJitterMs(record.descriptor, intervalMs)
  record.timer = setTimeout(() => {
    record.timer = null
    if (
      !started
      || tasks.get(taskId(record.descriptor.ownerNamespace, record.descriptor.key)) !== record
    ) {
      return
    }
    void BackgroundActivity.requestRun(
      record.descriptor.ownerNamespace,
      record.descriptor.key,
    ).finally(() => scheduleNext(record))
  }, delay)
  record.timer.unref()
}

function stableJitterMs(descriptor: MaintenanceTaskDescriptor, intervalMs: number): number {
  const range = Math.min(Math.floor(intervalMs / 10), MAX_JITTER_MS)
  if (range <= 0) {
    return 0
  }
  const value = `${descriptor.ownerNamespace}\u0000${descriptor.key}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % (range + 1)
}
