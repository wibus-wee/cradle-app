import { create } from 'zustand'

export interface ComposerInsertRequest {
  id: number
  text: string
  createdAt: number
}

interface ComposerInsertState {
  requests: Record<string, ComposerInsertRequest[]>
  enqueue: (sessionId: string, text: string) => void
  consume: (sessionId: string, requestId: number) => void
}

let nextComposerInsertId = 0

export const useComposerInsertStore = create<ComposerInsertState>()(set => ({
  requests: {},
  enqueue: (sessionId, text) => {
    if (!text) {
      return
    }
    const request = { id: ++nextComposerInsertId, text, createdAt: Date.now() }
    set(state => ({
      requests: {
        ...state.requests,
        [sessionId]: [...(state.requests[sessionId] ?? []), request],
      },
    }))
  },
  consume: (sessionId, requestId) => {
    set((state) => {
      const existing = state.requests[sessionId]
      if (!existing?.some(request => request.id === requestId)) {
        return state
      }
      const remaining = existing.filter(request => request.id !== requestId)
      const requests = { ...state.requests }
      if (remaining.length === 0) {
        delete requests[sessionId]
      }
      else {
        requests[sessionId] = remaining
      }
      return { requests }
    })
  },
}))

export function requestComposerInsert(sessionId: string, text: string): void {
  useComposerInsertStore.getState().enqueue(sessionId, text)
}

export function consumeComposerInsert(sessionId: string, requestId: number): void {
  useComposerInsertStore.getState().consume(sessionId, requestId)
}
