import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import type { ComposerDraft } from '~/store/composer-draft'
import { useComposerDraftStore } from '~/store/composer-draft'

const DEBOUNCE_MS = 300

const NOOP_HANDLER = () => {}

/**
 * Syncs a Composer's draft text + context parts with per-surface localStorage.
 *
 * On mount: reads persisted draft → returns replaceDraft/replaceDraftKey for externalSignals.
 * On change: debounced save to store.
 *
 * When surfaceId is empty, all returned handlers are no-ops.
 */
export function useComposerDraftSync(surfaceId: string) {
  const enabled = surfaceId !== ''
  const getDraft = useComposerDraftStore((s) => s.getDraft)
  const setDraft = useComposerDraftStore((s) => s.setDraft)
  const deleteDraft = useComposerDraftStore((s) => s.deleteDraft)

  // Read initial draft once on mount
  const [initialDraft] = useState<ComposerDraft | null>(() => enabled ? getDraft(surfaceId) : null)
  const [initialDraftKey] = useState(() => enabled && getDraft(surfaceId) ? 1 : 0)

  // Track current draft for debounced save
  const draftRef = useRef<ComposerDraft>(initialDraft ?? { text: '', contextParts: [] })
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Flush pending save on unmount
  useEffect(() => {
    if (!enabled) {
      return
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        const draft = draftRef.current
        if (draft.text.trim() || draft.contextParts.length > 0) {
          setDraft(surfaceId, draft)
        }
      }
    }
  }, [enabled, surfaceId, setDraft])

  const handleDraftPartsChange = useCallback(enabled
    ? (text: string, contextParts: ChatContextPart[]) => {
        draftRef.current = { text, contextParts }

        if (timerRef.current) {
          clearTimeout(timerRef.current)
        }

        // Don't persist empty drafts
        if (!text.trim() && contextParts.length === 0) {
          deleteDraft(surfaceId)
          return
        }

        timerRef.current = setTimeout(() => {
          setDraft(surfaceId, { text, contextParts })
        }, DEBOUNCE_MS)
      }
    : NOOP_HANDLER as (text: string, contextParts: ChatContextPart[]) => void,
  [enabled, surfaceId, setDraft, deleteDraft])

  return {
    /** Pass into Composer's externalSignals.replaceDraft */
    replaceDraft: initialDraft ?? undefined,
    /** Pass into Composer's externalSignals.replaceDraftKey */
    replaceDraftKey: initialDraftKey,
    /** Wire into Composer's view.onDraftPartsChange */
    handleDraftPartsChange,
  }
}
