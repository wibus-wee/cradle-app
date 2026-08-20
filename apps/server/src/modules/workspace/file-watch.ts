import type { FSWatcher } from 'node:fs'
import { statSync, watch } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

import { invalidateWorkspaceFileList } from './files'

export type WorkspaceFileChangeEvent
  = | {
    type: 'directory-changed'
    workspaceId: string
    path: string
    reason: 'direct' | 'ancestor'
    timestamp: number
  }
  | {
    type: 'file-changed'
    workspaceId: string
    path: string
    timestamp: number
  }

type WorkspaceFileChangeListener = (event: WorkspaceFileChangeEvent) => void

interface WorkspaceWatchRecord {
  key: string
  listeners: Set<WorkspaceFileChangeListener>
  refCount: number
  watcher: FSWatcher
  workspaceId: string
  workspacePath: string
}

const watchRecords = new Map<string, WorkspaceWatchRecord>()
const pendingEventsByKey = new Map<string, {
  event: WorkspaceFileChangeEvent
  record: WorkspaceWatchRecord
}>()
let flushTimer: NodeJS.Timeout | null = null

export function subscribeWorkspaceFileChanges(input: {
  workspaceId: string
  workspacePath: string
  listener: WorkspaceFileChangeListener
}): () => void {
  const workspacePath = resolve(input.workspacePath)
  const record = getOrCreateWatchRecord(input.workspaceId, workspacePath)
  record.refCount += 1
  record.listeners.add(input.listener)

  return () => {
    record.listeners.delete(input.listener)
    record.refCount -= 1
    if (record.refCount > 0) {
      return
    }
    record.watcher.close()
    watchRecords.delete(record.key)
  }
}

function getOrCreateWatchRecord(workspaceId: string, workspacePath: string): WorkspaceWatchRecord {
  const key = `${workspaceId}\0${workspacePath}`
  const existing = watchRecords.get(key)
  if (existing) {
    return existing
  }

  const record: WorkspaceWatchRecord = {
    key,
    listeners: new Set(),
    refCount: 0,
    watcher: watch(workspacePath, { recursive: true }, (_eventType, filename) => {
      invalidateWorkspaceFileList(workspacePath)
      const changedPath = readChangedRelativePath(workspacePath, filename)
      queueDirectoryChanged(record, readChangedDirectoryPath(changedPath), 'direct')
      if (changedPath && isExistingFile(workspacePath, changedPath)) {
        queueFileChanged(record, changedPath)
      }
    }),
    workspaceId,
    workspacePath,
  }
  record.watcher.on('error', () => {
    queueDirectoryChanged(record, '', 'direct')
  })
  watchRecords.set(key, record)
  return record
}

function readChangedRelativePath(
  workspacePath: string,
  filename: string | Buffer | null,
): string | null {
  if (!filename) {
    return null
  }
  const normalizedRelativePath = normalizeRelativePath(filename.toString())
  if (normalizedRelativePath.length === 0) {
    return null
  }
  const absolutePath = resolve(workspacePath, normalizedRelativePath)
  const resolvedRelativePath = relative(workspacePath, absolutePath)
  if (
    resolvedRelativePath === '..'
    || resolvedRelativePath.startsWith(`..${sep}`)
  ) {
    return null
  }
  return normalizeRelativePath(resolvedRelativePath)
}

function readChangedDirectoryPath(changedPath: string | null): string {
  if (!changedPath) {
    return ''
  }
  const parent = dirname(changedPath)
  return parent === '.' ? '' : normalizeRelativePath(parent)
}

function isExistingFile(workspacePath: string, changedPath: string): boolean {
  try {
    return statSync(resolve(workspacePath, changedPath)).isFile()
  }
  catch {
    return false
  }
}

function queueDirectoryChanged(
  record: WorkspaceWatchRecord,
  path: string,
  reason: 'direct' | 'ancestor',
): void {
  const event = {
    type: 'directory-changed',
    workspaceId: record.workspaceId,
    path,
    reason,
    timestamp: Date.now(),
  } satisfies WorkspaceFileChangeEvent
  pendingEventsByKey.set(`directory\0${record.key}\0${path}`, { event, record })
  const parentPath = readParentDirectoryPath(path)
  if (parentPath !== path) {
    queueDirectoryChanged(record, parentPath, 'ancestor')
  }
  if (flushTimer) {
    return
  }
  flushTimer = setTimeout(flushWorkspaceFileChangeEvents, 100)
}

function queueFileChanged(record: WorkspaceWatchRecord, path: string): void {
  const event = {
    type: 'file-changed',
    workspaceId: record.workspaceId,
    path,
    timestamp: Date.now(),
  } satisfies WorkspaceFileChangeEvent
  pendingEventsByKey.set(`file\0${record.key}\0${path}`, { event, record })
  if (flushTimer) {
    return
  }
  flushTimer = setTimeout(flushWorkspaceFileChangeEvents, 100)
}

function flushWorkspaceFileChangeEvents(): void {
  flushTimer = null
  const pendingEvents = [...pendingEventsByKey.values()]
  pendingEventsByKey.clear()
  for (const { event, record } of pendingEvents) {
    if (watchRecords.get(record.key) !== record) {
      continue
    }
    for (const listener of record.listeners) {
      listener(event)
    }
  }
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join('/').replace(/^\/+|\/+$/g, '')
}

function readParentDirectoryPath(path: string): string {
  if (!path) {
    return path
  }
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}
