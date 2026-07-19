import { useCallback, useSyncExternalStore } from 'react'

import { getAuthenticatedEventSourceUrl, getServerUrl } from '~/lib/electron'
import type { BrowserWorkflowRuntimeSnapshot } from '~/store/browser-panel'
import { browserWorkflowRuntimeSnapshotSchema } from '~/store/browser-panel'

interface WorkflowRuntimeEntry {
  snapshot: BrowserWorkflowRuntimeSnapshot | null
  listeners: Set<() => void>
  source: EventSource | null
  generation: number
}

const entries = new Map<string, WorkflowRuntimeEntry>()

function workflowRuntimeKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}\0${toolCallId}`
}

function getEntry(key: string): WorkflowRuntimeEntry {
  const existing = entries.get(key)
  if (existing) { return existing }
  const entry: WorkflowRuntimeEntry = {
    snapshot: null,
    listeners: new Set(),
    source: null,
    generation: 0,
  }
  entries.set(key, entry)
  return entry
}

function connect(key: string, sessionId: string, toolCallId: string): void {
  const entry = getEntry(key)
  if (entry.source) { return }
  const generation = ++entry.generation
  const endpoint = new URL(
    `/chat/sessions/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(toolCallId)}/stream`,
    getServerUrl(),
  ).toString()
  void getAuthenticatedEventSourceUrl(endpoint).then((url) => {
    if (entry.generation !== generation || entry.listeners.size === 0) { return }
    const source = new EventSource(url)
    entry.source = source
    source.onmessage = (event) => {
      const parsedJson = parseJson(event.data)
      const parsedSnapshot = browserWorkflowRuntimeSnapshotSchema.safeParse(parsedJson)
      if (!parsedSnapshot.success) { return }
      entry.snapshot = parsedSnapshot.data
      for (const listener of entry.listeners) { listener() }
    }
  }).catch(() => undefined)
}

function disconnect(key: string, entry: WorkflowRuntimeEntry): void {
  entry.generation += 1
  entry.source?.close()
  entry.source = null
  entries.delete(key)
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  }
  catch {
    return null
  }
}

export function useWorkflowRuntime(
  sessionId: string | null,
  toolCallId: string | null,
  initialSnapshot: BrowserWorkflowRuntimeSnapshot | null = null,
): BrowserWorkflowRuntimeSnapshot | null {
  const key = sessionId && toolCallId ? workflowRuntimeKey(sessionId, toolCallId) : null
  if (key && initialSnapshot) {
    const entry = getEntry(key)
    if (entry.snapshot === null || initialSnapshot.updatedAt > entry.snapshot.updatedAt) {
      entry.snapshot = initialSnapshot
    }
  }
  const subscribe = useCallback((listener: () => void) => {
    if (!key || !sessionId || !toolCallId) { return () => undefined }
    const entry = getEntry(key)
    entry.listeners.add(listener)
    connect(key, sessionId, toolCallId)
    return () => {
      entry.listeners.delete(listener)
      if (entry.listeners.size === 0) { disconnect(key, entry) }
    }
  }, [key, sessionId, toolCallId])
  const getSnapshot = useCallback(
    () => key ? (entries.get(key)?.snapshot ?? null) : null,
    [key],
  )
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => null,
  )
}
