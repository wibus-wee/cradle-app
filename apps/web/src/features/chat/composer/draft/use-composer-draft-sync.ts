import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import type { ComposerPastedText } from '~/features/chat/pasted-text/pasted-text'

import type { ComposerDraftSubmitToken } from './composer-draft-lifecycle'
import {
  activateComposerDraftSurface,
  beginComposerDraftSubmit,
  changeComposerDraft,
  clearComposerDraft,
  flushComposerDraft,
  noteComposerDraftRestore,
  queueComposerDraftServerWrite,
  settleComposerDraftSubmit,
} from './composer-draft-lifecycle'
import { readServerComposerDraft } from './composer-draft-server'
import type { ComposerDraft } from './composer-draft-store'
import {
  EMPTY_COMPOSER_DRAFT,
  hasComposerDraftContent,
  useComposerDraftStore,
} from './composer-draft-store'

interface ReplaceDraftState {
  draft: ComposerDraft | undefined
  key: number
}

/**
 * Syncs a Composer's draft text + context parts with localStorage and the server LWW draft row.
 *
 * On mount: activates the surface lifecycle, reads the local draft
 * synchronously, then reconciles the server draft. On change: routes through
 * the per-surface lifecycle owner, which owns the debounce, serialized server
 * writes, discard suppression, and submit tombstone settlement.
 *
 * When surfaceId is empty, all returned handlers are no-ops.
 */
export function useComposerDraftSync(surfaceId: string) {
  const enabled = surfaceId !== ''
  const getDraft = useComposerDraftStore(s => s.getDraft)
  const setDraft = useComposerDraftStore(s => s.setDraft)
  const deleteDraft = useComposerDraftStore(s => s.deleteDraft)

  const [replaceDraftState, setReplaceDraftState] = useState<ReplaceDraftState>(() => {
    const localDraft = enabled ? getDraft(surfaceId) : null
    return {
      draft: localDraft ?? undefined,
      key: localDraft ? 1 : 0,
    }
  })

  const activeSurfaceIdRef = useRef<string | null>(enabled ? surfaceId : null)
  const localEditVersionRef = useRef(0)
  const draftRef = useRef<ComposerDraft>(replaceDraftState.draft ?? EMPTY_COMPOSER_DRAFT)
  const skipNextEmptyDraftChangeRef = useRef(
    Boolean(replaceDraftState.draft && hasComposerDraftContent(replaceDraftState.draft)),
  )

  useEffect(() => {
    const activeSurfaceId = enabled ? surfaceId : null
    const surfaceChanged = activeSurfaceIdRef.current !== activeSurfaceId
    activeSurfaceIdRef.current = activeSurfaceId
    localEditVersionRef.current = 0

    if (!enabled) {
      draftRef.current = EMPTY_COMPOSER_DRAFT
      if (surfaceChanged) {
        setReplaceDraftState(state => ({
          draft: EMPTY_COMPOSER_DRAFT,
          key: state.key + 1,
        }))
      }
      return
    }

    const localDraft = getDraft(surfaceId)
    activateComposerDraftSurface(surfaceId, localDraft)
    draftRef.current = localDraft ?? EMPTY_COMPOSER_DRAFT
    if (surfaceChanged) {
      skipNextEmptyDraftChangeRef.current = Boolean(
        localDraft && hasComposerDraftContent(localDraft),
      )
      setReplaceDraftState(state => ({
        draft: localDraft ?? EMPTY_COMPOSER_DRAFT,
        key: state.key + 1,
      }))
    }

    const readVersion = localEditVersionRef.current
    const controller = new AbortController()

    void (async () => {
      try {
        const serverDraft = await readServerComposerDraft(surfaceId, controller.signal)
        if (controller.signal.aborted || readVersion !== localEditVersionRef.current) {
          return
        }

        if (serverDraft.draft) {
          setDraft(surfaceId, serverDraft.draft)
          noteComposerDraftRestore(surfaceId, serverDraft.draft, { persistedOnServer: true })
          draftRef.current = serverDraft.draft
          skipNextEmptyDraftChangeRef.current = hasComposerDraftContent(serverDraft.draft)
          setReplaceDraftState(state => ({
            draft: serverDraft.draft ?? EMPTY_COMPOSER_DRAFT,
            key: state.key + 1,
          }))
          return
        }

        if (serverDraft.revision > 0) {
          deleteDraft(surfaceId)
          noteComposerDraftRestore(surfaceId, EMPTY_COMPOSER_DRAFT, { persistedOnServer: true })
          draftRef.current = EMPTY_COMPOSER_DRAFT
          setReplaceDraftState(state => ({
            draft: EMPTY_COMPOSER_DRAFT,
            key: state.key + 1,
          }))
          return
        }

        if (localDraft && hasComposerDraftContent(localDraft)) {
          queueComposerDraftServerWrite(surfaceId, localDraft)
        }
      }
 catch {
        // Keep local draft behavior when the server is temporarily unavailable.
      }
    })()

    return () => {
      controller.abort()
    }
  }, [enabled, surfaceId, getDraft, setDraft, deleteDraft])

  // Flush pending save on unmount — a no-op once the surface is discarded.
  useEffect(() => {
    if (!enabled) {
      return
    }
    return () => {
      flushComposerDraft(surfaceId)
    }
  }, [enabled, surfaceId])

  const clearDraft = useCallback(() => {
    if (!enabled) {
      return
    }

    localEditVersionRef.current += 1
    draftRef.current = EMPTY_COMPOSER_DRAFT
    skipNextEmptyDraftChangeRef.current = false

    clearComposerDraft(surfaceId)
  }, [enabled, surfaceId])

  const handleDraftPartsChange = useCallback(
    (
      text: string,
      contextParts: ChatContextPart[],
      files: ComposerDraft['files'],
      pastedTexts: ComposerPastedText[],
    ) => {
      if (!enabled) {
        return
      }

      const draft = { text, contextParts, files, pastedTexts }
      const draftHasContent = hasComposerDraftContent(draft)
      if (
        !draftHasContent
        && skipNextEmptyDraftChangeRef.current
        && hasComposerDraftContent(draftRef.current)
      ) {
        skipNextEmptyDraftChangeRef.current = false
        return
      }

      skipNextEmptyDraftChangeRef.current = false
      localEditVersionRef.current += 1
      draftRef.current = draft

      changeComposerDraft(surfaceId, draft)
    },
    [enabled, surfaceId],
  )

  const beginDraftSubmit = useCallback((): ComposerDraftSubmitToken | null => {
    if (!enabled) {
      return null
    }
    return beginComposerDraftSubmit(surfaceId)
  }, [enabled, surfaceId])

  const settleDraftSubmit = useCallback(
    (token: ComposerDraftSubmitToken | null, accepted: boolean) => {
      if (!enabled) {
        return
      }
      settleComposerDraftSubmit(surfaceId, token, accepted)
    },
    [enabled, surfaceId],
  )

  return {
    /** Pass into Composer's externalSignals.replaceDraft */
    replaceDraft: replaceDraftState.draft,
    /** Pass into Composer's externalSignals.replaceDraftKey */
    replaceDraftKey: replaceDraftState.key,
    /** Clears the local draft cache and writes a server tombstone. */
    clearDraft,
    /** Wire into Composer's view.onDraftPartsChange */
    handleDraftPartsChange,
    /**
     * Marks a submission start so the optimistic clear does not delete the
     * persisted draft. Returns a token to settle via `settleDraftSubmit`.
     */
    beginDraftSubmit,
    /** Commits exactly one tombstone when the submission is accepted. */
    settleDraftSubmit,
  }
}
