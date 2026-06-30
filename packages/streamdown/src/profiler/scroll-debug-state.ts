import { useSyncExternalStore } from 'react'

export interface ScrollDebugState {
  scrollOffset: number
  scrollSize: number
  viewportSize: number
  distanceFromBottom: number
  isAtBottom: boolean
  isScrolling: boolean
  isGenerating: boolean
  log: ScrollLogEntry[]
}

export interface ScrollLogEntry {
  time: number
  event: string
  detail?: string
}

const MAX_LOG = 50

let state: ScrollDebugState = {
  scrollOffset: 0,
  scrollSize: 0,
  viewportSize: 0,
  distanceFromBottom: 0,
  isAtBottom: true,
  isScrolling: false,
  isGenerating: false,
  log: [],
}

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => fn())
}

export function updateScrollDebug(partial: Partial<ScrollDebugState>) {
  state = { ...state, ...partial }
  emit()
}

export function logScrollEvent(event: string, detail?: string) {
  const entry: ScrollLogEntry = { time: Date.now(), event, detail }
  state = { ...state, log: [...state.log.slice(-(MAX_LOG - 1)), entry] }
  emit()
}

export function useScrollDebugState(): ScrollDebugState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => state,
    () => state,
  )
}

export function getScrollDebugState(): ScrollDebugState {
  return state
}

export function resetScrollDebug() {
  state = { scrollOffset: 0, scrollSize: 0, viewportSize: 0, distanceFromBottom: 0, isAtBottom: true, isScrolling: false, isGenerating: false, log: [] }
  emit()
}
