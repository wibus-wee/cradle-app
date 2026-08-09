import { create } from 'zustand'

import { getObservabilityEvents, getObservabilityIncidents } from '~/api-gen/sdk.gen'
import type {
  GetObservabilityEventsResponse,
  GetObservabilityIncidentsResponse,
} from '~/api-gen/types.gen'

export type ObservabilityEntry
  = | { kind: 'event', payload: GetObservabilityEventsResponse[number] }
    | { kind: 'incident', payload: GetObservabilityIncidentsResponse[number] }

interface ObservabilityDevtoolState {
  entries: ObservabilityEntry[]
  selectedIndex: number | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
  selectIndex: (index: number | null) => void
  clear: () => void
}

export const useObservabilityDevtoolStore = create<ObservabilityDevtoolState>(set => ({
  entries: [],
  selectedIndex: null,
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null })
    try {
      const [eventsResponse, incidentsResponse] = await Promise.all([
        getObservabilityEvents({
          query: { limit: '200' },
          throwOnError: true,
        }),
        getObservabilityIncidents({
          query: { limit: '50' },
          throwOnError: true,
        }),
      ])
      const events = eventsResponse.data
      const incidents = incidentsResponse.data

      const entries: ObservabilityEntry[] = [
        ...events.map(e => ({ kind: 'event' as const, payload: e })),
        ...incidents.map(i => ({ kind: 'incident' as const, payload: i })),
      ].sort((a, b) => {
        const aTime = a.kind === 'event' ? a.payload.recordedAt : a.payload.lastRecordedAt
        const bTime = b.kind === 'event' ? b.payload.recordedAt : b.payload.lastRecordedAt
        return bTime - aTime
      })

      set({ entries, loading: false })
    }
    catch (err) {
      set({ error: String(err), loading: false })
    }
  },
  selectIndex: selectedIndex => set({ selectedIndex }),
  clear: () => set({ entries: [], selectedIndex: null }),
}))
