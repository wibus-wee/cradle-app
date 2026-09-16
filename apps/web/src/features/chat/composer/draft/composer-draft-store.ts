import type { FileUIPart } from 'ai'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import type { ComposerPastedText } from '~/features/chat/pasted-text/pasted-text'
import { persistStorage } from '~/store/persist-storage'

/**
 * A composer's visible draft payload. `files` participates in in-memory restore
 * and submit rollback only — durable draft payloads strip attachments before
 * writing (see `toPersistedComposerDraft`).
 */
export interface ComposerDraft {
  text: string
  contextParts: ChatContextPart[]
  files: FileUIPart[]
  pastedTexts: ComposerPastedText[]
}

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  text: '',
  contextParts: [],
  files: [],
  pastedTexts: [],
}

/** True when the visible draft holds user content worth restoring. */
export function hasComposerDraftContent(draft: ComposerDraft): boolean {
  return (
    draft.text.trim() !== ''
    || draft.contextParts.length > 0
    || draft.files.length > 0
    || draft.pastedTexts.length > 0
  )
}

/**
 * The draft shape allowed into durable storage (localStorage persist and the
 * server LWW row). `FileUIPart` attachments are intentionally excluded: they
 * carry raw data URLs whose size/security/serialization contract has not been
 * designed, so they must not land in the existing draft JSON.
 */
export function toPersistedComposerDraft(draft: ComposerDraft): ComposerDraft {
  return {
    text: draft.text,
    contextParts: draft.contextParts,
    files: [],
    pastedTexts: draft.pastedTexts,
  }
}

/** True when the persisted payload itself carries user content. */
export function hasPersistedComposerDraftContent(draft: ComposerDraft): boolean {
  return (
    draft.text.trim() !== ''
    || draft.contextParts.length > 0
    || draft.pastedTexts.length > 0
  )
}

interface ComposerDraftState {
  drafts: Record<string, ComposerDraft>
  getDraft: (surfaceId: string) => ComposerDraft | null
  setDraft: (surfaceId: string, draft: ComposerDraft) => void
  deleteDraft: (surfaceId: string) => void
}

/**
 * Chat-owned per-surface composer draft cache. In-memory entries keep the full
 * visible draft (including attachments) so same-session remounts restore the
 * composer exactly; `partialize` strips attachments before localStorage.
 */
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
      partialize: state => ({
        drafts: Object.fromEntries(
          Object.entries(state.drafts).map(([surfaceId, draft]) => [
            surfaceId,
            toPersistedComposerDraft(draft),
          ]),
        ),
      }),
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
