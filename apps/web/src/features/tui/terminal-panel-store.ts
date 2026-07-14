import { create } from 'zustand'

import type { TerminalLayoutNode, TerminalSplitDirection } from './terminal-pane-layout'
import {
  activateTerminalSession,
  addTerminalTab,
  collectTerminalSessionIds,
  createTerminalPane,
  removeTerminalSession,
  resizeTerminalSplit,
  splitTerminalPane,
} from './terminal-pane-layout'

export const MAX_TERMINAL_PANES = 6

export interface TerminalPanelSession {
  id: string
  title: string
  cwd: string
  createdAt: number
}

export interface TerminalPanelOwnerState {
  sessions: TerminalPanelSession[]
  activeSessionId: string | null
  nextIndex: number
  layout: TerminalLayoutNode | null
}

interface TerminalPanelState {
  owners: Record<string, TerminalPanelOwnerState>
  registerOwner: (ownerId: string, cwd: string) => void
  addSession: (ownerId: string, cwd: string) => TerminalPanelSession
  splitSession: (
    ownerId: string,
    cwd: string,
    direction: TerminalSplitDirection,
  ) => TerminalPanelSession | null
  activateSession: (ownerId: string, sessionId: string) => void
  removeSession: (ownerId: string, sessionId: string) => number | null
  removeOwner: (ownerId: string) => TerminalPanelSession[]
  resizeSplit: (ownerId: string, splitId: string, weights: number[]) => void
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

function buildInitialOwnerState(ownerId: string, cwd: string, index = 1): TerminalPanelOwnerState {
  const session = createSession(ownerId, cwd, index)
  return {
    sessions: [session],
    activeSessionId: session.id,
    nextIndex: index + 1,
    layout: createTerminalPane(session.id),
  }
}

function createAndInsertSession(input: {
  ownerId: string
  cwd: string
  owner: TerminalPanelOwnerState | undefined
  mode: 'tab' | 'split'
  direction?: TerminalSplitDirection
}): { owner: TerminalPanelOwnerState, session: TerminalPanelSession } {
  const current = input.owner ?? {
    sessions: [],
    activeSessionId: null,
    nextIndex: 1,
    layout: null,
  }
  const session = createSession(input.ownerId, input.cwd, current.nextIndex)
  const targetSessionId = current.activeSessionId ?? collectTerminalSessionIds(current.layout)[0] ?? null

  let layout = current.layout
  if (!layout || !targetSessionId) {
    layout = createTerminalPane(session.id)
  }
  else if (input.mode === 'split') {
    layout = splitTerminalPane({
      node: layout,
      targetSessionId,
      newSessionId: session.id,
      direction: input.direction ?? 'horizontal',
    })
  }
  else {
    layout = addTerminalTab(layout, targetSessionId, session.id)
  }

  return {
    session,
    owner: {
      sessions: [...current.sessions, session],
      activeSessionId: session.id,
      nextIndex: current.nextIndex + 1,
      layout,
    },
  }
}

export const useTerminalPanelStore = create<TerminalPanelState>()(
  (set, get) => ({
    owners: {},
    registerOwner: (ownerId, cwd) => {
      set((state) => {
        const owner = state.owners[ownerId]
        if (owner?.sessions.length) {
          return state
        }

        return {
          owners: {
            ...state.owners,
            [ownerId]: buildInitialOwnerState(ownerId, cwd, owner?.nextIndex ?? 1),
          },
        }
      })
    },
    addSession: (ownerId, cwd) => {
      let created!: TerminalPanelSession
      set((state) => {
        const result = createAndInsertSession({
          ownerId,
          cwd,
          owner: state.owners[ownerId],
          mode: 'tab',
        })
        created = result.session
        return { owners: { ...state.owners, [ownerId]: result.owner } }
      })
      return created
    },
    splitSession: (ownerId, cwd, direction) => {
      let created: TerminalPanelSession | null = null
      set((state) => {
        const owner = state.owners[ownerId]
        if (collectTerminalSessionIds(owner?.layout ?? null).length >= MAX_TERMINAL_PANES) {
          return state
        }
        const result = createAndInsertSession({ ownerId, cwd, owner, mode: 'split', direction })
        created = result.session
        return { owners: { ...state.owners, [ownerId]: result.owner } }
      })
      return created
    },
    activateSession: (ownerId, sessionId) => {
      set((state) => {
        const owner = state.owners[ownerId]
        if (!owner?.layout || !owner.sessions.some(session => session.id === sessionId)) {
          return state
        }
        const layout = activateTerminalSession(owner.layout, sessionId)
        if (owner.activeSessionId === sessionId && layout === owner.layout) {
          return state
        }
        return {
          owners: {
            ...state.owners,
            [ownerId]: { ...owner, activeSessionId: sessionId, layout },
          },
        }
      })
    },
    removeSession: (ownerId, sessionId) => {
      let remainingCount: number | null = null
      set((state) => {
        const owner = state.owners[ownerId]
        if (!owner?.sessions.some(session => session.id === sessionId)) {
          return state
        }

        const sessions = owner.sessions.filter(session => session.id !== sessionId)
        const layout = owner.layout ? removeTerminalSession(owner.layout, sessionId) : null
        const visibleSessionIds = collectTerminalSessionIds(layout)
        remainingCount = sessions.length
        return {
          owners: {
            ...state.owners,
            [ownerId]: {
              ...owner,
              sessions,
              activeSessionId: owner.activeSessionId !== sessionId
                ? owner.activeSessionId
                : visibleSessionIds.at(-1) ?? null,
              layout,
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
    resizeSplit: (ownerId, splitId, weights) => {
      set((state) => {
        const owner = state.owners[ownerId]
        if (!owner?.layout) {
          return state
        }
        const layout = resizeTerminalSplit(owner.layout, splitId, weights)
        return layout === owner.layout
          ? state
          : { owners: { ...state.owners, [ownerId]: { ...owner, layout } } }
      })
    },
    updateSessionTitle: (ownerId, sessionId, title) => {
      set((state) => {
        const owner = state.owners[ownerId]
        const trimmed = title.trim()
        if (!owner || !trimmed) {
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
