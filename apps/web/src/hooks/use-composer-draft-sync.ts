import { useCallback, useEffect, useRef, useState } from 'react'

import {
  activateComposerDraftSurface,
  queueServerComposerDraftDelete,
  queueServerComposerDraftWrite,
  readServerComposerDraft,
} from '~/features/chat/commands/composer-draft-command'
import type { ComposerPastedText } from '~/features/chat/composer/pasted-text'
import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import type { ComposerDraft } from '~/store/composer-draft'
import { useComposerDraftStore } from '~/store/composer-draft'

const DEBOUNCE_MS = 300

const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  text: '',
  contextParts: [],
  files: [],
  pastedTexts: [],
}

interface ReplaceDraftState {
  draft: ComposerDraft | undefined
  key: number
}

function hasComposerDraftContent(draft: ComposerDraft): boolean {
  return (
    draft.text.trim() !== ''
    || draft.contextParts.length > 0
    || draft.files.length > 0
    || draft.pastedTexts.length > 0
  )
}

/**
 * Syncs a Composer's draft text + context parts with localStorage and the server LWW draft row.
 *
 * On mount: reads local draft synchronously, then reconciles the server draft.
 * On change: debounced local save plus serialized server write/delete.
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

    activateComposerDraftSurface(surfaceId)

    const localDraft = getDraft(surfaceId)
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
          draftRef.current = EMPTY_COMPOSER_DRAFT
          setReplaceDraftState(state => ({
            draft: EMPTY_COMPOSER_DRAFT,
            key: state.key + 1,
          }))
          return
        }

        if (localDraft && hasComposerDraftContent(localDraft)) {
          queueServerComposerDraftWrite(surfaceId, localDraft)
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

  // Flush pending save on unmount
  useEffect(() => {
    if (!enabled) {
      return
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        const draft = draftRef.current
        if (hasComposerDraftContent(draft)) {
          setDraft(surfaceId, draft)
          queueServerComposerDraftWrite(surfaceId, draft)
          return
        }
        deleteDraft(surfaceId)
        queueServerComposerDraftDelete(surfaceId)
      }
    }
  }, [enabled, surfaceId, setDraft, deleteDraft])

  const clearDraft = useCallback(() => {
    if (!enabled) {
      return
    }

    localEditVersionRef.current += 1
    draftRef.current = EMPTY_COMPOSER_DRAFT
    skipNextEmptyDraftChangeRef.current = false

    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    deleteDraft(surfaceId)
    queueServerComposerDraftDelete(surfaceId)
  }, [enabled, surfaceId, deleteDraft])

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

      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }

      // Don't persist empty drafts
      if (!draftHasContent) {
        deleteDraft(surfaceId)
        queueServerComposerDraftDelete(surfaceId)
        return
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null
        setDraft(surfaceId, draft)
        queueServerComposerDraftWrite(surfaceId, draft)
      }, DEBOUNCE_MS)
    },
    [enabled, surfaceId, setDraft, deleteDraft],
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
  }
}
