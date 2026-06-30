import { create } from 'zustand'

export interface TerminalPanelSession {
  id: string
  title: string
  cwd: string
  createdAt: number
}

interface TerminalPanelOwnerState {
  sessions: TerminalPanelSession[]
  activeSessionId: string | null
  nextIndex: number
}

interface TerminalPanelState {
  owners: Record<string, TerminalPanelOwnerState>
  registerOwner: (ownerId: string, cwd: string) => void
  addSession: (ownerId: string, cwd: string) => TerminalPanelSession
  activateSession: (ownerId: string, sessionId: string) => void
  removeSession: (ownerId: string, sessionId: string) => number | null
  removeOwner: (ownerId: string) => TerminalPanelSession[]
  updateSessionTitle: (ownerId: string, sessionId: string, title: string) => void
}

function createSession(ownerId: string, cwd: string, index: number): TerminalPanelSession {
  return {
    id: `terminal:${ownerId}:${index}`,
    title: index === 1 ? 'Terminal' : `Terminal ${index}`,
    cwd,
    createdAt: Date.now(),
  }
}

function buildInitialOwnerState(ownerId: string, cwd: string): TerminalPanelOwnerState {
  return {
    sessions: [createSession(ownerId, cwd, 1)],
    activeSessionId: `terminal:${ownerId}:1`,
    nextIndex: 2,
  }
}

export const useTerminalPanelStore = create<TerminalPanelState>()(
  (set, get) => ({
    owners: {},
    registerOwner: (ownerId, cwd) => {
      set((state) => {
        const owner = state.owners[ownerId]
        if (owner && owner.sessions.length > 0) {
          return state
        }

        if (owner) {
          const index = owner.nextIndex
          const session = createSession(ownerId, cwd, index)
          return {
            owners: {
              ...state.owners,
              [ownerId]: {
                sessions: [session],
                activeSessionId: session.id,
                nextIndex: index + 1,
              },
            },
          }
        }

        return {
          owners: {
            ...state.owners,
            [ownerId]: buildInitialOwnerState(ownerId, cwd),
          },
        }
      })
    },
    addSession: (ownerId, cwd) => {
      let session = createSession(ownerId, cwd, 1)

      set((state) => {
        const owner = state.owners[ownerId] ?? {
          sessions: [],
          activeSessionId: null,
          nextIndex: 1,
        }
        const index = owner.nextIndex
        session = createSession(ownerId, cwd, index)

        return {
          owners: {
            ...state.owners,
            [ownerId]: {
              sessions: [...owner.sessions, session],
              activeSessionId: session.id,
              nextIndex: index + 1,
            },
          },
        }
      })

      return session
    },
    activateSession: (ownerId, sessionId) => {
      set((state) => {
        const owner = state.owners[ownerId]
        if (!owner || owner.activeSessionId === sessionId || !owner.sessions.some(session => session.id === sessionId)) {
          return state
        }

        return {
          owners: {
            ...state.owners,
            [ownerId]: {
              ...owner,
              activeSessionId: sessionId,
            },
          },
        }
      })
    },
    removeSession: (ownerId, sessionId) => {
      let remainingCount: number | null = null

      set((state) => {
        const owner = state.owners[ownerId]
        if (!owner) {
          return state
        }

        if (!owner.sessions.some(session => session.id === sessionId)) {
          return state
        }

        const sessions = owner.sessions.filter(session => session.id !== sessionId)
        remainingCount = sessions.length
        if (sessions.length === 0) {
          return {
            owners: {
              ...state.owners,
              [ownerId]: {
                sessions: [],
                activeSessionId: null,
                nextIndex: owner.nextIndex,
              },
            },
          }
        }

        return {
          owners: {
            ...state.owners,
            [ownerId]: {
              ...owner,
              sessions,
              activeSessionId: owner.activeSessionId === sessionId ? sessions.at(-1)!.id : owner.activeSessionId,
            },
          },
        }
      })

      return remainingCount
    },
    removeOwner: (ownerId) => {
      const owner = get().owners[ownerId]
      if (!owner) {
        return []
      }

      set((state) => {
        if (!(ownerId in state.owners)) {
          return state
        }

        const { [ownerId]: _removed, ...owners } = state.owners
        return { owners }
      })

      return owner.sessions
    },
    updateSessionTitle: (ownerId, sessionId, title) => {
      set((state) => {
        const owner = state.owners[ownerId]
        if (!owner) {
          return state
        }

        const trimmed = title.trim()
        if (!trimmed) {
          return state
        }

        return {
          owners: {
            ...state.owners,
            [ownerId]: {
              ...owner,
              sessions: owner.sessions.map(session => (
                session.id === sessionId && session.title !== trimmed
                  ? { ...session, title: trimmed }
                  : session
              )),
            },
          },
        }
      })
    },
  }),
)
