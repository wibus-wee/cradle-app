import { create } from 'zustand'

interface SessionActivityState {
  visibleSessionId: string | null
  setVisibleSession: (sessionId: string | null) => void
}

export const useSessionActivityStore = create<SessionActivityState>()(set => ({
  visibleSessionId: null,
  setVisibleSession: visibleSessionId =>
    set({ visibleSessionId }),
}))
