import { AppError } from '../../errors/app-error'

export type BackgroundActivityPriority = 'low' | 'normal' | 'high'
export type BackgroundActivityStatus = 'idle' | 'running' | 'succeeded' | 'failed'
export type BackgroundActivityProgressValue
  = | string
    | number
    | boolean
    | null
    | BackgroundActivityProgress
    | BackgroundActivityProgressValue[]
export interface BackgroundActivityProgress {
  [key: string]: BackgroundActivityProgressValue
}

export interface BackgroundActivityReporter {
  report: (progress: BackgroundActivityProgress | null) => void
}

export interface BackgroundActivityDescriptor {
  ownerNamespace: string
  key: string
  title: string
  priority: BackgroundActivityPriority
  trigger: string
  manuallyRunnable: boolean
  run: (reporter: BackgroundActivityReporter) => Promise<void>
}

export interface BackgroundActivitySnapshot {
  ownerNamespace: string
  key: string
  title: string
  priority: BackgroundActivityPriority
  trigger: string
  manuallyRunnable: boolean
  status: BackgroundActivityStatus
  progress: BackgroundActivityProgress | null
  lastError: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  finishedAt: number | null
}

interface ActivityRecord {
  descriptor: BackgroundActivityDescriptor
  status: BackgroundActivityStatus
  progress: BackgroundActivityProgress | null
  lastError: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  finishedAt: number | null
  runPromise: Promise<BackgroundActivitySnapshot> | null
}

const activities = new Map<string, ActivityRecord>()

function storageKey(ownerNamespace: string, key: string): string {
  return `${ownerNamespace}\u0000${key}`
}

function snapshot(record: ActivityRecord): BackgroundActivitySnapshot {
  return {
    ownerNamespace: record.descriptor.ownerNamespace,
    key: record.descriptor.key,
    title: record.descriptor.title,
    priority: record.descriptor.priority,
    trigger: record.descriptor.trigger,
    manuallyRunnable: record.descriptor.manuallyRunnable,
    status: record.status,
    progress: record.progress,
    lastError: record.lastError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  }
}

function requireActivity(ownerNamespace: string, key: string): ActivityRecord {
  const record = activities.get(storageKey(ownerNamespace, key))
  if (!record) {
    throw new AppError({
      code: 'background_activity_not_found',
      status: 404,
      message: 'Background activity was not found.',
      details: { ownerNamespace, key },
    })
  }
  return record
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function compareSnapshots(left: BackgroundActivitySnapshot, right: BackgroundActivitySnapshot): number {
  const runningOrder = Number(right.status === 'running') - Number(left.status === 'running')
  if (runningOrder !== 0) {
    return runningOrder
  }
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt
  }
  const leftKey = storageKey(left.ownerNamespace, left.key)
  const rightKey = storageKey(right.ownerNamespace, right.key)
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

function isCurrent(record: ActivityRecord): boolean {
  return activities.get(storageKey(record.descriptor.ownerNamespace, record.descriptor.key)) === record
}

function run(record: ActivityRecord): Promise<BackgroundActivitySnapshot> {
  const descriptor = record.descriptor
  const now = Date.now()
  record.status = 'running'
  record.progress = null
  record.lastError = null
  record.startedAt = now
  record.finishedAt = null
  record.updatedAt = now

  const reporter: BackgroundActivityReporter = {
    report(progress) {
      if (!isCurrent(record) || record.status !== 'running') {
        return
      }
      record.progress = progress
      record.updatedAt = Date.now()
    },
  }

  const promise = Promise.resolve()
    .then(() => descriptor.run(reporter))
    .then(
      () => {
        if (isCurrent(record) && record.status === 'running') {
          const finishedAt = Date.now()
          record.status = 'succeeded'
          record.finishedAt = finishedAt
          record.updatedAt = finishedAt
        }
        return snapshot(record)
      },
      (error: unknown) => {
        if (isCurrent(record) && record.status === 'running') {
          const finishedAt = Date.now()
          record.status = 'failed'
          record.lastError = errorMessage(error)
          record.finishedAt = finishedAt
          record.updatedAt = finishedAt
        }
        return snapshot(record)
      },
    )
    .finally(() => {
      if (isCurrent(record)) {
        record.runPromise = null
      }
    })

  record.runPromise = promise
  return promise
}

/**
 * Registers an activity by its owner namespace and key. Re-registering the
 * same identity updates the descriptor without discarding its live snapshot.
 */
export function register(descriptor: BackgroundActivityDescriptor): BackgroundActivitySnapshot {
  const key = storageKey(descriptor.ownerNamespace, descriptor.key)
  const existing = activities.get(key)
  if (existing) {
    existing.descriptor = descriptor
    return snapshot(existing)
  }

  const now = Date.now()
  const record: ActivityRecord = {
    descriptor,
    status: 'idle',
    progress: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    runPromise: null,
  }
  activities.set(key, record)
  return snapshot(record)
}

export function unregister(ownerNamespace: string, key: string): void {
  activities.delete(storageKey(ownerNamespace, key))
}

export function list(): BackgroundActivitySnapshot[] {
  return Array.from(activities.values(), snapshot).sort(compareSnapshots)
}

export function requestRun(ownerNamespace: string, key: string): Promise<BackgroundActivitySnapshot> {
  const record = requireActivity(ownerNamespace, key)
  return record.runPromise ?? run(record)
}

export function requestManualRun(
  ownerNamespace: string,
  key: string,
): Promise<BackgroundActivitySnapshot> {
  const record = requireActivity(ownerNamespace, key)
  if (!record.descriptor.manuallyRunnable) {
    throw new AppError({
      code: 'background_activity_not_manually_runnable',
      status: 409,
      message: 'Background activity cannot be run manually.',
      details: { ownerNamespace, key },
    })
  }
  return record.runPromise ?? run(record)
}

/** Starts a manually runnable activity without making an HTTP caller wait for it. */
export function startManualRun(ownerNamespace: string, key: string): BackgroundActivitySnapshot {
  const record = requireActivity(ownerNamespace, key)
  if (!record.descriptor.manuallyRunnable) {
    throw new AppError({
      code: 'background_activity_not_manually_runnable',
      status: 409,
      message: 'Background activity cannot be run manually.',
      details: { ownerNamespace, key },
    })
  }
  void (record.runPromise ?? run(record))
  return snapshot(record)
}

/** Clears registered activity state and invalidates reporters from in-flight runs. */
export function stop(): void {
  activities.clear()
}

export const reset = stop
