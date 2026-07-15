import { useCallback, useSyncExternalStore } from 'react'

import { desktopDownloadCenterTransport, serverDownloadCenterTransport } from './transport'
import type { DownloadCenterSnapshot, DownloadTask } from './types'
import { downloadTaskKey, isActiveDownload } from './types'

type Listener = () => void
type DownloadOwnerSelector = Pick<DownloadTask['owner'], 'namespace'> & Partial<Pick<DownloadTask['owner'], 'resourceType'>>

const EMPTY_SNAPSHOT: DownloadCenterSnapshot = { tasks: [], active: [], recent: [] }
const transports = [serverDownloadCenterTransport, desktopDownloadCenterTransport].filter((transport): transport is NonNullable<typeof transport> => transport !== null)
let tasks = new Map<string, DownloadTask>()
let snapshot = EMPTY_SNAPSHOT
const ownerSnapshots = new Map<string, readonly DownloadTask[]>()
const ownerListeners = new Map<string, Set<Listener>>()
let stop: (() => void) | null = null
const listeners = new Set<Listener>()

export function projectDownloadCenterTasks(nextTasks: Iterable<DownloadTask>): DownloadCenterSnapshot {
  const keys = new Map(Array.from(nextTasks, task => [downloadTaskKey(task), task]))
  const ordered = Array.from(keys.values()).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return {
    tasks: ordered,
    active: ordered.filter(isActiveDownload),
    recent: ordered.filter(task => !isActiveDownload(task)),
  }
}

export function replaceDownloadScopeSnapshot(
  current: ReadonlyMap<string, DownloadTask>,
  scope: DownloadTask['scope'],
  nextTasks: readonly DownloadTask[],
): Map<string, DownloadTask> {
  const next = new Map(current)
  for (const [key, task] of next) {
    if (task.scope === scope) {
      next.delete(key)
    }
  }
  for (const task of nextTasks) {
    next.set(downloadTaskKey(task), task)
  }
  return next
}

function publish(next: Map<string, DownloadTask>): void {
  tasks = next
  snapshot = projectDownloadCenterTasks(tasks.values())
  for (const listener of listeners) { listener() }
  for (const [key, subscriptions] of ownerListeners) {
    const owner = ownerFromKey(key)
    const previous = ownerSnapshots.get(key) ?? EMPTY_SNAPSHOT.tasks
    const selected = selectOwnerTasks(snapshot.tasks, owner)
    if (sameTasks(previous, selected)) { continue }
    ownerSnapshots.set(key, selected)
    for (const listener of subscriptions) { listener() }
  }
}

export function clearDownloadCenterProjection(): void {
  ownerSnapshots.clear()
  publish(new Map())
}

function stopAndClearIfUnused(): void {
  if (listeners.size !== 0 || ownerListeners.size !== 0) {
    return
  }
  stop?.()
  // A mount after all subscribers left must wait for a host snapshot instead
  // of briefly projecting task history from the prior subscription.
  clearDownloadCenterProjection()
}

function merge(task: DownloadTask): void {
  const key = downloadTaskKey(task)
  const current = tasks.get(key)
  if (current && Date.parse(current.updatedAt) > Date.parse(task.updatedAt)) { return }
  const next = new Map(tasks)
  next.set(key, task)
  publish(next)
}

/** Applies a host event to the shared projection. */
export function applyDownloadCenterTask(task: DownloadTask): void {
  merge(task)
}

async function refresh(transportIndex?: number): Promise<void> {
  const selected = transportIndex === undefined ? transports : [transports[transportIndex]]
  const lists = await Promise.all(selected.map(transport => transport.list().catch(() => [])))
  let next = new Map(tasks)
  for (const [index, list] of lists.entries()) {
    const transport = selected[index]
    if (transport) {
      next = replaceDownloadScopeSnapshot(next, transport.scope, list)
    }
  }
  publish(next)
}

function ensureStarted(): void {
  if (stop) { return }
  void refresh()
  const unsubscribers = transports.map((transport, index) => transport.subscribe(merge, async () => {
    // A fresh snapshot establishes the reconnect baseline before new SSE events are accepted.
    await refresh(index)
  }))
  stop = () => {
    for (const unsubscribe of unsubscribers) { unsubscribe() }
    stop = null
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  ensureStarted()
  return () => {
    listeners.delete(listener)
    stopAndClearIfUnused()
  }
}

export function useDownloadCenter(): DownloadCenterSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY_SNAPSHOT)
}

/** A dedicated selector keeps high-frequency transfer updates out of unrelated chrome. */
export function useDownloadCenterTasks(): readonly DownloadTask[] {
  return useDownloadCenter().tasks
}

/** Subscribes to an owner projection without allocating or rerendering for other owners. */
export function useDownloadCenterOwner(
  owner: DownloadOwnerSelector,
): readonly DownloadTask[] {
  const key = ownerKey(owner)
  return useSyncExternalStore(
    listener => subscribeOwner(key, listener),
    () => ownerSnapshot(key, owner),
    () => EMPTY_SNAPSHOT.tasks,
  )
}

export function useDownloadCenterCancel(): (task: DownloadTask) => Promise<void> {
  return useCallback(async (task: DownloadTask) => {
    ensureStarted()
    const transport = transports.find(candidate => candidate === serverDownloadCenterTransport
      ? task.scope === 'server'
      : task.scope === 'desktop')
    const next = await transport?.cancel(task)
    if (next) { merge(next) }
  }, [])
}

export function downloadTasksForOwner(
  downloadTasks: readonly DownloadTask[],
  owner: DownloadOwnerSelector,
): readonly DownloadTask[] {
  return selectOwnerTasks(downloadTasks, owner)
}

function ownerSnapshot(
  key: string,
  owner: DownloadOwnerSelector,
): readonly DownloadTask[] {
  const cached = ownerSnapshots.get(key)
  if (cached) { return cached }
  const selected = downloadTasksForOwner(snapshot.tasks, owner)
  ownerSnapshots.set(key, selected)
  return selected
}

function subscribeOwner(key: string, listener: Listener): () => void {
  const subscriptions = ownerListeners.get(key) ?? new Set<Listener>()
  subscriptions.add(listener)
  ownerListeners.set(key, subscriptions)
  ensureStarted()
  return () => {
    subscriptions.delete(listener)
    if (subscriptions.size === 0) {
      ownerListeners.delete(key)
      ownerSnapshots.delete(key)
    }
    stopAndClearIfUnused()
  }
}

function ownerKey(owner: DownloadOwnerSelector): string {
  return `${owner.namespace}:${owner.resourceType ?? '*'}`
}

function ownerFromKey(key: string): DownloadOwnerSelector {
  const [namespace, resourceType] = key.split(':')
  return resourceType === '*' ? { namespace: namespace! } : { namespace: namespace!, resourceType: resourceType! }
}

function selectOwnerTasks(tasks: readonly DownloadTask[], owner: DownloadOwnerSelector): readonly DownloadTask[] {
  return tasks.filter(task => task.owner.namespace === owner.namespace && (owner.resourceType === undefined || task.owner.resourceType === owner.resourceType))
}

function sameTasks(left: readonly DownloadTask[], right: readonly DownloadTask[]): boolean {
  return left.length === right.length && left.every((task, index) => task === right[index])
}
