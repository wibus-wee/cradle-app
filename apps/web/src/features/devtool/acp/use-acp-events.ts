// Input: ACP devtool preload API, ACP runtime event types, Zustand selectors
// Output: ACP devtool stores and derived hooks for filtered ACP process events
// Position: Core state layer for the ACP runtime pane inside the devtool feature

import { useMemo } from 'react'
import { create } from 'zustand'

// Types mirrored from @cradle/ipc
export type AcpDevtoolEventKind = 'spawn' | 'output' | 'exit'
export type AcpDevtoolEventStream = 'stdout' | 'stderr' | 'lifecycle'

export interface AcpDevtoolEvent {
  id: string
  timestamp: number
  agentId: string
  pid: number | null
  kind: AcpDevtoolEventKind
  stream: AcpDevtoolEventStream
  text: string
  command: string | null
  args: string[] | null
  cwd: string | null
  exitCode: number | null
  signal: string | null
}

const MAX_EVENTS = 5000

type AcpDevtoolStream = AcpDevtoolEvent['stream']

interface AcpDevtoolState {
  events: AcpDevtoolEvent[]
  paused: boolean
  selectedEventId: string | null
  initialized: boolean
  initialize: () => Promise<void>
  append: (event: AcpDevtoolEvent) => void
  setPaused: (paused: boolean) => void
  clear: () => void
  selectEvent: (eventId: string | null) => void
}

// ── RAF batch buffer for high-frequency event ingestion ──────────────────────
const _acpBatch: AcpDevtoolEvent[] = []
let _acpRafId: ReturnType<typeof requestAnimationFrame> | null = null

export const useAcpDevtoolStore = create<AcpDevtoolState>((set, get) => ({
  events: [],
  paused: false,
  selectedEventId: null,
  initialized: false,

  initialize: async () => {
    if (get().initialized) {
      return
    }
    set({ initialized: true })

    try {
      const snapshot = (await window.ipcDevtool.getAcpSnapshot()) as AcpDevtoolEvent[]
      if (Array.isArray(snapshot)) {
        set({ events: snapshot.slice(-MAX_EVENTS) })
      }
    }
    catch (error) {
      console.error('[devtool] getAcpSnapshot failed:', error)
    }

    window.ipcDevtool.onAcpEvent((event) => {
      get().append(event as AcpDevtoolEvent)
    })
  },

  append: (event) => {
    if (get().paused) {
      return
    }
    _acpBatch.push(event as AcpDevtoolEvent)
    if (_acpRafId !== null) {
      return
    }
    _acpRafId = requestAnimationFrame(() => {
      _acpRafId = null
      if (_acpBatch.length === 0) {
        return
      }
      const batch = _acpBatch.splice(0)
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
    void window.ipcDevtool.clearAcp()
    set({ events: [], selectedEventId: null })
  },

  selectEvent: selectedEventId => set({ selectedEventId }),
}))

export interface AcpFilters {
  search: string
  selectedAgentId: string
  streams: Record<AcpDevtoolStream, boolean>
}

interface AcpFiltersState {
  filters: AcpFilters
  setSearch: (search: string) => void
  setSelectedAgentId: (agentId: string) => void
  toggleStream: (stream: AcpDevtoolStream) => void
}

export const useAcpFiltersStore = create<AcpFiltersState>((set, get) => ({
  filters: {
    search: '',
    selectedAgentId: 'all',
    streams: {
      stdout: true,
      stderr: true,
      lifecycle: true,
    },
  },
  setSearch: search => set({ filters: { ...get().filters, search } }),
  setSelectedAgentId: selectedAgentId => set({ filters: { ...get().filters, selectedAgentId } }),
  toggleStream: (stream) => {
    const current = get().filters
    set({
      filters: {
        ...current,
        streams: { ...current.streams, [stream]: !current.streams[stream] },
      },
    })
  },
}))

export function useAcpAgentIds(): string[] {
  const events = useAcpDevtoolStore(s => s.events)
  return useMemo(() => {
    return [...new Set(events.map(event => event.agentId))].sort((left, right) => left.localeCompare(right))
  }, [events])
}

export function useAcpFilteredEvents(): AcpDevtoolEvent[] {
  const events = useAcpDevtoolStore(s => s.events)
  const filters = useAcpFiltersStore(s => s.filters)

  return useMemo(() => {
    const query = filters.search.trim().toLowerCase()
    return [...events]
      .filter((event) => {
        if (!filters.streams[event.stream]) {
          return false
        }
        if (filters.selectedAgentId !== 'all' && event.agentId !== filters.selectedAgentId) {
          return false
        }
        if (!query) {
          return true
        }

        const haystack = [
          event.agentId,
          event.stream,
          event.kind,
          event.text,
          event.command ?? '',
          event.cwd ?? '',
          event.args?.join(' ') ?? '',
        ].join(' ').toLowerCase()
        return haystack.includes(query)
      })
      .sort((left, right) => right.timestamp - left.timestamp)
  }, [events, filters])
}
