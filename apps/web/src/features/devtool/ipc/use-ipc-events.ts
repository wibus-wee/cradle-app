// Input: window.ipcDevtool preload API, Zustand create/selectors
// Output: useIpcDevtoolStore / useIpcFiltersStore / useIpcTraces / useIpcFilteredTraces hooks driving the devtool UI
// Position: Core state layer for the ipc-devtool feature (single producer, single consumer per devtool window)

import { useMemo } from 'react'
import { create } from 'zustand'

// Types mirrored from @cradle/ipc to avoid pulling the full package into the web bundle
export type IpcObservedSide = 'renderer' | 'main'
export type IpcObservedPhase = 'start' | 'finish'
export type IpcObservedStatus = 'pending' | 'success' | 'error'

export interface IpcObservedPayload {
  json: string
  summary: string
  truncated: boolean
}

export interface IpcObservedEvent {
  id: string
  traceId: string
  spanId: string
  parentSpanId: string | null
  channel: string
  side: IpcObservedSide
  phase: IpcObservedPhase
  status: IpcObservedStatus
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  args: IpcObservedPayload | null
  result: IpcObservedPayload | null
  error: IpcObservedPayload | null
  callerStack: string[]
  flowId?: string
}

const MAX_EVENTS = 5000

export interface IpcTracePhases {
  'renderer:start': IpcObservedEvent | null
  'main:start': IpcObservedEvent | null
  'main:finish': IpcObservedEvent | null
  'renderer:finish': IpcObservedEvent | null
}

export interface IpcTrace {
  traceId: string
  channel: string
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  status: IpcObservedStatus
  phases: IpcTracePhases
  args: IpcObservedPayload | null
  result: IpcObservedPayload | null
  error: IpcObservedPayload | null
  callerStack: string[]
  flowId?: string
}

export type IpcDetailTab = 'args' | 'result' | 'error' | 'stack'

export const IPC_DETAIL_TAB_ORDER: IpcDetailTab[] = ['args', 'result', 'error', 'stack']

interface IpcDevtoolState {
  events: IpcObservedEvent[]
  paused: boolean
  selectedTraceId: string | null
  detailTab: IpcDetailTab
  initialized: boolean
  initialize: () => Promise<void>
  append: (event: IpcObservedEvent) => void
  setPaused: (paused: boolean) => void
  clear: () => void
  selectTrace: (traceId: string | null) => void
  setDetailTab: (tab: IpcDetailTab) => void
  cycleDetailTab: (direction: 1 | -1) => void
}

// ── RAF batch buffer for high-frequency event ingestion ──────────────────────
const _ipcBatch: IpcObservedEvent[] = []
let _ipcRafId: ReturnType<typeof requestAnimationFrame> | null = null

export const useIpcDevtoolStore = create<IpcDevtoolState>((set, get) => ({
  events: [],
  paused: false,
  selectedTraceId: null,
  detailTab: 'args',
  initialized: false,

  initialize: async () => {
    if (get().initialized) {
      return
    }
    set({ initialized: true })

    try {
      const snapshot = (await window.ipcDevtool.getSnapshot()) as IpcObservedEvent[]
      if (Array.isArray(snapshot)) {
        set({ events: snapshot.slice(-MAX_EVENTS) })
      }
    }
    catch (error) {
      console.error('[ipc-devtool] getSnapshot failed:', error)
    }

    window.ipcDevtool.onEvent((event) => {
      get().append(event as IpcObservedEvent)
    })
  },

  append: (event) => {
    if (get().paused) {
      return
    }
    _ipcBatch.push(event as IpcObservedEvent)
    if (_ipcRafId !== null) {
      return
    }
    _ipcRafId = requestAnimationFrame(() => {
      _ipcRafId = null
      if (_ipcBatch.length === 0) {
        return
      }
      const batch = _ipcBatch.splice(0)
      if (get().paused) {
        return
      }
      const existing = get().events
      const combined = [...existing, ...batch]
      const next = combined.length > MAX_EVENTS
        ? combined.slice(combined.length - MAX_EVENTS)
        : combined
      set({ events: next })
    })
  },

  setPaused: paused => set({ paused }),

  clear: () => {
    void window.ipcDevtool.clear()
    set({ events: [], selectedTraceId: null })
  },

  selectTrace: traceId => set({ selectedTraceId: traceId }),

  setDetailTab: tab => set({ detailTab: tab }),

  cycleDetailTab: (direction) => {
    const idx = IPC_DETAIL_TAB_ORDER.indexOf(get().detailTab)
    const nextIdx = (idx + direction + IPC_DETAIL_TAB_ORDER.length) % IPC_DETAIL_TAB_ORDER.length
    set({ detailTab: IPC_DETAIL_TAB_ORDER[nextIdx] })
  },
}))

export interface IpcFilters {
  search: string
  statuses: Record<IpcObservedStatus, boolean>
  sides: Record<IpcObservedSide, boolean>
}

interface IpcFiltersState {
  filters: IpcFilters
  setSearch: (search: string) => void
  toggleStatus: (status: IpcObservedStatus) => void
  toggleSide: (side: IpcObservedSide) => void
}

export const useIpcFiltersStore = create<IpcFiltersState>((set, get) => ({
  filters: {
    search: '',
    statuses: { pending: true, success: true, error: true },
    sides: { renderer: true, main: true },
  },
  setSearch: search => set({ filters: { ...get().filters, search } }),
  toggleStatus: (status) => {
    const current = get().filters
    set({
      filters: {
        ...current,
        statuses: { ...current.statuses, [status]: !current.statuses[status] },
      },
    })
  },
  toggleSide: (side) => {
    const current = get().filters
    set({
      filters: {
        ...current,
        sides: { ...current.sides, [side]: !current.sides[side] },
      },
    })
  },
}))

const PHASE_KEYS: Array<keyof IpcTracePhases> = [
  'renderer:start',
  'main:start',
  'main:finish',
  'renderer:finish',
]

function phaseKey(event: IpcObservedEvent): keyof IpcTracePhases {
  return `${event.side}:${event.phase}` as keyof IpcTracePhases
}

function emptyPhases(): IpcTracePhases {
  return {
    'renderer:start': null,
    'main:start': null,
    'main:finish': null,
    'renderer:finish': null,
  }
}

export function useIpcTraces(): IpcTrace[] {
  const events = useIpcDevtoolStore(s => s.events)

  return useMemo(() => {
    const map = new Map<string, IpcTrace>()

    for (const event of events) {
      let trace = map.get(event.traceId)
      if (!trace) {
        trace = {
          traceId: event.traceId,
          channel: event.channel,
          startedAt: event.startedAt,
          endedAt: null,
          durationMs: null,
          status: 'pending',
          phases: emptyPhases(),
          args: null,
          result: null,
          error: null,
          callerStack: event.callerStack,
        }
        map.set(event.traceId, trace)
      }

      trace.phases[phaseKey(event)] = event

      if (event.startedAt < trace.startedAt) {
        trace.startedAt = event.startedAt
      }
      if (event.endedAt !== null) {
        trace.endedAt = trace.endedAt === null ? event.endedAt : Math.max(trace.endedAt, event.endedAt)
      }

      if (event.args) { trace.args = event.args }
      if (event.result) { trace.result = event.result }
      if (event.error) { trace.error = event.error }
      if (event.callerStack.length > 0) { trace.callerStack = event.callerStack }
      if (event.flowId !== undefined) { trace.flowId = event.flowId }
    }

    for (const trace of map.values()) {
      trace.status = deriveStatus(trace)
      if (trace.endedAt !== null) {
        trace.durationMs = trace.endedAt - trace.startedAt
      }
    }

    return [...map.values()].sort((a, b) => b.startedAt - a.startedAt)
  }, [events])
}

/**
 * Return all traces that share the same flowId, in chronological order.
 * Used by the devtool to render a selected one-way push stream (e.g. the
 * sequence of chat:message-chunk events for a single session) as a timeline.
 */
export function useIpcFlowTraces(flowId: string | null | undefined): IpcTrace[] {
  const traces = useIpcTraces()
  return useMemo(() => {
    if (!flowId) { return [] }
    return traces
      .filter(t => t.flowId === flowId)
      .sort((a, b) => a.startedAt - b.startedAt)
  }, [traces, flowId])
}

function deriveStatus(trace: IpcTrace): IpcObservedStatus {
  for (const key of PHASE_KEYS) {
    const ev = trace.phases[key]
    if (ev?.status === 'error') { return 'error' }
  }
  const rendererFinish = trace.phases['renderer:finish']
  if (rendererFinish) { return rendererFinish.status }
  const mainFinish = trace.phases['main:finish']
  if (mainFinish) { return mainFinish.status }
  return 'pending'
}

export function useIpcFilteredTraces(): IpcTrace[] {
  const traces = useIpcTraces()
  const filters = useIpcFiltersStore(s => s.filters)

  return useMemo(() => {
    const query = filters.search.trim().toLowerCase()
    return traces.filter((trace) => {
      if (!filters.statuses[trace.status]) { return false }

      const hasIncludedSide = PHASE_KEYS.some((key) => {
        const ev = trace.phases[key]
        return ev !== null && filters.sides[ev.side]
      })
      if (!hasIncludedSide) { return false }

      if (query) {
        const haystack = [
          trace.channel,
          trace.args?.summary ?? '',
          trace.result?.summary ?? '',
          trace.error?.summary ?? '',
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(query)) { return false }
      }
      return true
    })
  }, [traces, filters])
}
