import type { FileUIPart } from 'ai'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ComposerPastedText } from '~/features/chat/composer/pasted-text'
import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'

import { persistStorage } from './persist-storage'

export interface ComposerDraft {
  text: string
  contextParts: ChatContextPart[]
  files: FileUIPart[]
  pastedTexts: ComposerPastedText[]
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
            && existing.files.length === draft.files.length
            && existing.files.every((part, i) => part === draft.files[i])
            && existing.pastedTexts.length === draft.pastedTexts.length
            && existing.pastedTexts.every((part, i) => part === draft.pastedTexts[i])
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
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<ComposerDraftState> | undefined
        const drafts = Object.fromEntries(
          Object.entries(state?.drafts ?? {}).map(([surfaceId, draft]) => [
            surfaceId,
            {
              text: draft.text ?? '',
              contextParts: draft.contextParts ?? [],
              files: draft.files ?? [],
              pastedTexts: draft.pastedTexts ?? [],
            },
          ]),
        )
        return { ...state, drafts } as ComposerDraftState
      },
    },
  ),
)
