import { useSyncExternalStore } from 'react'

export interface StreamDebugState {
  targetLength: number
  displayedLength: number
  currentCps: number
  arrivalCps: number
  phase: 'idle' | 'active' | 'settling'
  renderStalls: number
  apiStalls: number
  backlog: number
  cpsHistory: number[]
  bufferHistory: number[]
}

const RING_BUFFER_SIZE = 60

function createInitialState(): StreamDebugState {
  return {
    targetLength: 0,
    displayedLength: 0,
    currentCps: 0,
    arrivalCps: 0,
    phase: 'idle',
    renderStalls: 0,
    apiStalls: 0,
    backlog: 0,
    cpsHistory: [],
    bufferHistory: [],
  }
}

let state: StreamDebugState = createInitialState()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function updateDebugState(partial: Partial<StreamDebugState>): void {
  state = { ...state, ...partial }
  emit()
}

export function pushCpsHistory(cps: number): void {
  const history = [...state.cpsHistory, cps]
  if (history.length > RING_BUFFER_SIZE) {
    history.shift()
  }
  state = { ...state, cpsHistory: history }
  emit()
}

export function pushBufferHistory(backlog: number): void {
  const history = [...state.bufferHistory, backlog]
  if (history.length > RING_BUFFER_SIZE) {
    history.shift()
  }
  state = { ...state, bufferHistory: history }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): StreamDebugState {
  return state
}

export function useStreamDebugState(): StreamDebugState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getDebugState(): StreamDebugState {
  return state
}

export function resetDebugState(): void {
  state = createInitialState()
  emit()
}
