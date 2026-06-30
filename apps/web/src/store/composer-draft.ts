import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'

import { persistStorage } from './persist-storage'

export interface ComposerDraft {
  text: string
  contextParts: ChatContextPart[]
}

interface ComposerDraftState {
  drafts: Record<string, ComposerDraft>
  getDraft: (surfaceId: string) => ComposerDraft | null
  setDraft: (surfaceId: string, draft: ComposerDraft) => void
  deleteDraft: (surfaceId: string) => void
}

export const useComposerDraftStore = create<ComposerDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},

      getDraft: (surfaceId) => {
        return get().drafts[surfaceId] ?? null
      },

      setDraft: (surfaceId, draft) => {
        set((state) => {
          const existing = state.drafts[surfaceId]
          // Skip update if content is identical
          if (
            existing
            && existing.text === draft.text
            && existing.contextParts.length === draft.contextParts.length
            && existing.contextParts.every((part, i) => part === draft.contextParts[i])
          ) {
            return state
          }
          return {
            drafts: { ...state.drafts, [surfaceId]: draft },
          }
        })
      },

      deleteDraft: (surfaceId) => {
        set((state) => {
          if (!(surfaceId in state.drafts)) {
            return state
          }
          const next = { ...state.drafts }
          delete next[surfaceId]
          return { drafts: next }
        })
      },
    }),
    {
      name: 'cradle:composer-drafts:v1',
      storage: persistStorage,
      version: 1,
    },
  ),
)
