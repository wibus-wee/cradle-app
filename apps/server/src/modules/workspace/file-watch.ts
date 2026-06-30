import type { FSWatcher } from 'node:fs'
import { watch } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

import { invalidateWorkspaceFileList } from './files'

export interface WorkspaceFileChangeEvent {
  type: 'directory-changed'
  workspaceId: string
  path: string
  reason: 'direct' | 'ancestor'
  timestamp: number
}

type WorkspaceFileChangeListener = (event: WorkspaceFileChangeEvent) => void

interface WorkspaceWatchRecord {
  listeners: Set<WorkspaceFileChangeListener>
  refCount: number
  watcher: FSWatcher
  workspaceId: string
  workspacePath: string
}

const watchRecords = new Map<string, WorkspaceWatchRecord>()
const pendingEventsByKey = new Map<string, WorkspaceFileChangeEvent>()
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
    watchRecords.delete(input.workspaceId)
  }
}

function getOrCreateWatchRecord(workspaceId: string, workspacePath: string): WorkspaceWatchRecord {
  const existing = watchRecords.get(workspaceId)
  if (existing && existing.workspacePath === workspacePath) {
    return existing
  }
  existing?.watcher.close()

  const record: WorkspaceWatchRecord = {
    listeners: new Set(),
    refCount: 0,
    watcher: watch(workspacePath, { recursive: true }, (_eventType, filename) => {
      invalidateWorkspaceFileList(workspacePath)
      queueDirectoryChanged(record, readChangedDirectoryPath(workspacePath, filename), 'direct')
    }),
    workspaceId,
    workspacePath,
  }
  record.watcher.on('error', () => {
    queueDirectoryChanged(record, '', 'direct')
  })
  watchRecords.set(workspaceId, record)
  return record
}

function readChangedDirectoryPath(workspacePath: string, filename: string | Buffer | null): string {
  if (!filename) {
    return ''
  }
  const normalizedRelativePath = normalizeRelativePath(filename.toString())
  if (normalizedRelativePath.length === 0) {
    return ''
  }
  const absolutePath = resolve(workspacePath, normalizedRelativePath)
  const parent = dirname(absolutePath)
  if (parent === workspacePath) {
    return ''
  }
  return normalizeRelativePath(relative(workspacePath, parent))
}

function queueDirectoryChanged(record: WorkspaceWatchRecord, path: string, reason: WorkspaceFileChangeEvent['reason']): void {
  const event = {
    type: 'directory-changed',
    workspaceId: record.workspaceId,
    path,
    reason,
    timestamp: Date.now(),
  } satisfies WorkspaceFileChangeEvent
  pendingEventsByKey.set(`${record.workspaceId}\0${path}`, event)
  const parentPath = readParentDirectoryPath(path)
  if (parentPath !== path) {
    queueDirectoryChanged(record, parentPath, 'ancestor')
  }
  if (flushTimer) {
    return
  }
  flushTimer = setTimeout(flushWorkspaceFileChangeEvents, 100)
}

function flushWorkspaceFileChangeEvents(): void {
  flushTimer = null
  const events = [...pendingEventsByKey.values()]
  pendingEventsByKey.clear()
  for (const event of events) {
    const record = watchRecords.get(event.workspaceId)
    if (!record) {
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
