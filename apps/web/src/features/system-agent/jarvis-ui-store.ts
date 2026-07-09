import { z } from 'zod'
import type { StoreApi, UseBoundStore } from 'zustand'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const JARVIS_UI_SYNC_CHANNEL_NAME = 'cradle:jarvis-ui:persist-sync'
const DEFAULT_JARVIS_UI_PERSIST_KEY = 'jarvis-ui'
const DEFAULT_PANEL_WIDTH = 420
const DEFAULT_PANEL_HEIGHT = 520

export interface JarvisSession {
  id: string
  title: string
  createdAt: number
}

export interface JarvisUiState {
  expanded: boolean
  setExpanded: (expanded: boolean) => void

  includeContext: boolean
  setIncludeContext: (includeContext: boolean) => void

  // Window dimensions (persisted)
  panelWidth: number
  panelHeight: number
  setPanelSize: (width: number, height: number) => void

  // Session management
  sessions: JarvisSession[]
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  addSession: (session: JarvisSession) => void
  updateSessionTitle: (id: string, title: string) => void
  closeSessionTab: (id: string) => void
}

interface JarvisUiStoreOptions {
  persistKey?: string
  crossWindowSync?: boolean
}

interface PersistedJarvisUiSlice {
  includeContext: boolean
  panelWidth: number
  panelHeight: number
  sessions: JarvisSession[]
  activeSessionId: string | null
}

interface PersistedStoreSyncOptions<TState, TPersistedState> {
  store: UseBoundStore<StoreApi<TState>>
  persistKey: string
  channelName: string
  selectPersistedState: (state: TState) => TPersistedState
  applyPersistedState: (persistedState: TPersistedState) => void
}

function installPersistedStoreSync<TState, TPersistedState>({
  store,
  channelName,
  selectPersistedState,
  applyPersistedState,
}: PersistedStoreSyncOptions<TState, TPersistedState>): () => void {
  if (typeof BroadcastChannel === 'undefined') {
    return () => {}
  }

  const channel = new BroadcastChannel(channelName)
  let applyingRemoteState = false

  const unsubscribe = store.subscribe((state) => {
    if (applyingRemoteState) {
      return
    }
    channel.postMessage(selectPersistedState(state))
  })

  channel.addEventListener('message', (event: MessageEvent<TPersistedState>) => {
    applyingRemoteState = true
    try {
      applyPersistedState(event.data)
    }
    finally {
      applyingRemoteState = false
    }
  })

  return () => {
    unsubscribe()
    channel.close()
  }
}

const JarvisSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number().finite(),
})

const PersistedJarvisUiSliceSchema = z.object({
  includeContext: z.boolean().default(true),
  panelWidth: z.number().finite().positive().default(DEFAULT_PANEL_WIDTH),
  panelHeight: z.number().finite().positive().default(DEFAULT_PANEL_HEIGHT),
  sessions: z.array(JarvisSessionSchema).default([]),
  activeSessionId: z.string().nullable().default(null),
})

function selectPersistedJarvisUiSlice(state: JarvisUiState): PersistedJarvisUiSlice {
  return {
    includeContext: state.includeContext,
    panelWidth: state.panelWidth,
    panelHeight: state.panelHeight,
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
  }
}

function sanitizePersistedJarvisUiState(value: unknown): PersistedJarvisUiSlice {
  const result = PersistedJarvisUiSliceSchema.safeParse(value ?? {})
  const persisted = result.success
    ? result.data
    : {
        includeContext: true,
        panelWidth: DEFAULT_PANEL_WIDTH,
        panelHeight: DEFAULT_PANEL_HEIGHT,
        sessions: [],
        activeSessionId: null,
      }
  const activeSessionId = persisted.activeSessionId !== null
    && persisted.sessions.some(session => session.id === persisted.activeSessionId)
    ? persisted.activeSessionId
    : null

  return {
    ...persisted,
    activeSessionId,
  }
}

export function createJarvisUiStore(options?: JarvisUiStoreOptions) {
  const persistKey = options?.persistKey ?? DEFAULT_JARVIS_UI_PERSIST_KEY

  const store = create<JarvisUiState>()(
    persist(
      set => ({
        expanded: false,
        setExpanded: expanded => set({ expanded }),

        includeContext: true,
        setIncludeContext: includeContext => set({ includeContext }),

        panelWidth: DEFAULT_PANEL_WIDTH,
        panelHeight: DEFAULT_PANEL_HEIGHT,
        setPanelSize: (panelWidth, panelHeight) => set({ panelWidth, panelHeight }),

        sessions: [],
        activeSessionId: null,
        setActiveSessionId: activeSessionId => set({ activeSessionId }),
        addSession: session => set(s => ({
          sessions: [
            ...s.sessions.filter(existing => existing.id !== session.id),
            session,
          ],
        })),
        updateSessionTitle: (id, title) => set((s) => {
          const trimmedTitle = title.trim()
          if (!trimmedTitle) {
            return s
          }

          let changed = false
          const sessions = s.sessions.map((session) => {
            if (session.id !== id || session.title === trimmedTitle) {
              return session
            }
            changed = true
            return { ...session, title: trimmedTitle }
          })

          return changed ? { sessions } : s
        }),
        closeSessionTab: id => set(s => ({
          sessions: s.sessions.filter(sess => sess.id !== id),
          activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
        })),
      }),
      {
        name: persistKey,
        partialize: selectPersistedJarvisUiSlice,
        merge: (persisted, current) => ({
          ...current,
          ...sanitizePersistedJarvisUiState(persisted),
        }),
      },
    ),
  )

  if (options?.crossWindowSync !== false && typeof window !== 'undefined') {
    installPersistedStoreSync({
      store,
      persistKey,
      channelName: JARVIS_UI_SYNC_CHANNEL_NAME,
      selectPersistedState: selectPersistedJarvisUiSlice,
      applyPersistedState: persistedState => store.setState(sanitizePersistedJarvisUiState(persistedState)),
    })
  }

  return store
}

export const useJarvisUiStore = createJarvisUiStore()
