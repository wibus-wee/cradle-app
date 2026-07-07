import { create } from 'zustand'

/**
 * Ephemeral UI-only state tracking which sessions are mid title-regeneration.
 *
 * Ownership: this is a renderer-local presentation concern. It drives ONLY the
 * session title's shimmer affordance — never sorting, filtering, or persistence.
 * Kept deliberately separate from the streaming/error sets in the chat store so
 * it cannot leak into list ordering and so only the affected title re-renders.
 */
interface TitleRegenerationState {
  regeneratingSessionIds: Set<string>
  beginRegeneration: (sessionId: string) => void
  endRegeneration: (sessionId: string) => void
  isRegenerating: (sessionId: string) => boolean
}

export const useTitleRegenerationStore = create<TitleRegenerationState>()((set, get) => ({
  regeneratingSessionIds: new Set(),
  beginRegeneration: sessionId =>
    set((state) => {
      if (state.regeneratingSessionIds.has(sessionId)) {
        return state
      }
      const next = new Set(state.regeneratingSessionIds)
      next.add(sessionId)
      return { regeneratingSessionIds: next }
    }),
  endRegeneration: sessionId =>
    set((state) => {
      if (!state.regeneratingSessionIds.has(sessionId)) {
        return state
      }
      const next = new Set(state.regeneratingSessionIds)
      next.delete(sessionId)
      return { regeneratingSessionIds: next }
    }),
  isRegenerating: sessionId => get().regeneratingSessionIds.has(sessionId),
}))
