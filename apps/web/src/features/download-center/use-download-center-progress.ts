import type { DownloadTask } from './types'
import { useDownloadCenterOwner } from './use-download-center'

type DownloadOwnerSelector = Pick<DownloadTask['owner'], 'namespace'> & Partial<Pick<DownloadTask['owner'], 'resourceType'>>

/** Aggregates determinate byte progress without inventing a value for unknown totals. */
export function aggregateDownloadProgressByKey<Key extends string>(
  tasks: Iterable<DownloadTask>,
  keyForTask: (task: DownloadTask) => Key | null,
): Partial<Record<Key, number>> {
  const totals = new Map<Key, { transferredBytes: number, totalBytes: number }>()
  for (const task of tasks) {
    const key = keyForTask(task)
    if (key === null || task.totalBytes === null) { continue }
    const total = totals.get(key) ?? { transferredBytes: 0, totalBytes: 0 }
    total.transferredBytes += Math.min(task.transferredBytes, task.totalBytes)
    total.totalBytes += task.totalBytes
    totals.set(key, total)
  }
  return Object.fromEntries(
    Array.from(totals, ([key, total]) => [
      key,
      Math.round((total.transferredBytes / total.totalBytes) * 100),
    ]),
  ) as Partial<Record<Key, number>>
}

/** Selects one Download Center owner and projects determinate progress by caller key. */
export function useDownloadCenterProgressByOwner<Key extends string>(
  owner: DownloadOwnerSelector,
  active: boolean,
  keyForTask: (task: DownloadTask) => Key | null,
): Partial<Record<Key, number>> {
  const tasks = useDownloadCenterOwner(owner)
  return active ? aggregateDownloadProgressByKey(tasks, keyForTask) : {}
}
