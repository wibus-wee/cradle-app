import { z } from 'zod'
import { create } from 'zustand'

import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()

interface ObservabilityEvent {
  id: string
  source: string
  code: string
  severity: string
  category: string
  message: string
  attrs?: Record<string, unknown>
  chatSessionId?: string
  runId?: string
  occurredAt: number
  recordedAt: number
}

interface ObservabilityIncident {
  id: string
  dedupeKey: string
  code: string
  severity: string
  status: 'open' | 'resolved'
  source: string
  message: string
  chatSessionId?: string
  runId?: string
  firstOccurredAt: number
  lastOccurredAt: number
  lastRecordedAt: number
  count: number
}

const ObservabilityEventSchema = z.object({
  id: z.string(),
  source: z.string(),
  code: z.string(),
  severity: z.string(),
  category: z.string(),
  message: z.string(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  chatSessionId: z.string().optional(),
  runId: z.string().optional(),
  occurredAt: z.number().finite(),
  recordedAt: z.number().finite(),
})

const ObservabilityIncidentSchema = z.object({
  id: z.string(),
  dedupeKey: z.string(),
  code: z.string(),
  severity: z.string(),
  status: z.enum(['open', 'resolved']),
  source: z.string(),
  message: z.string(),
  chatSessionId: z.string().optional(),
  runId: z.string().optional(),
  firstOccurredAt: z.number().finite(),
  lastOccurredAt: z.number().finite(),
  lastRecordedAt: z.number().finite(),
  count: z.number().finite(),
})

const ObservabilityEventsSchema = z.array(ObservabilityEventSchema)
const ObservabilityIncidentsSchema = z.array(ObservabilityIncidentSchema)

export type ObservabilityEntry
  = | { kind: 'event', payload: ObservabilityEvent }
    | { kind: 'incident', payload: ObservabilityIncident }

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
      const [eventsRes, incidentsRes] = await Promise.all([
        fetch(`${SERVER_BASE}/observability/events?limit=200`),
        fetch(`${SERVER_BASE}/observability/incidents?limit=50`),
      ])
      if (!eventsRes.ok || !incidentsRes.ok) {
        throw new Error('Failed to load observability entries')
      }

      const events = ObservabilityEventsSchema.parse(await eventsRes.json())
      const incidents = ObservabilityIncidentsSchema.parse(await incidentsRes.json())

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
