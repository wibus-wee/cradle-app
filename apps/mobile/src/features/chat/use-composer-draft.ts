import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  DeleteChatComposerDraftsBySurfaceIdResponse,
  GetChatComposerDraftsBySurfaceIdResponse,
  PutChatComposerDraftsBySurfaceIdResponse,
} from '@/api-gen'
import type { CradleConnection } from '@/lib/api'
import { cradleRequest } from '@/lib/api'

import type { ChatComposerDraft } from './ChatComposer'

const SAVE_DELAY_MS = 300

function hasContent(draft: ChatComposerDraft): boolean {
  return draft.text.trim() !== '' || draft.files.length > 0
}

export function useComposerDraft(
  connection: CradleConnection | null,
  sessionId: string,
  enabled: boolean,
) {
  const surfaceId = `chat:${sessionId}`
  const latestDraftRef = useRef<ChatComposerDraft>({ files: [], text: '' })
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [clearSignal, setClearSignal] = useState(0)
  const query = useQuery({
    enabled: Boolean(connection) && enabled,
    queryKey: ['composer-draft', connection?.resourceId, surfaceId],
    queryFn: ({ signal }) =>
      cradleRequest<GetChatComposerDraftsBySurfaceIdResponse>(
        connection!,
        `/chat/composer-drafts/${encodeURIComponent(surfaceId)}`,
        { signal },
      ),
  })

  const enqueue = useCallback((draft: ChatComposerDraft | null) => {
    if (!connection) {
      return
    }
    queueRef.current = queueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (draft) {
          await cradleRequest<PutChatComposerDraftsBySurfaceIdResponse>(
            connection,
            `/chat/composer-drafts/${encodeURIComponent(surfaceId)}`,
            {
              body: {
                draft: {
                  contextParts: [],
                  files: draft.files,
                  pastedTexts: [],
                  text: draft.text,
                },
              },
              method: 'PUT',
            },
          )
          return
        }
        await cradleRequest<DeleteChatComposerDraftsBySurfaceIdResponse>(
          connection,
          `/chat/composer-drafts/${encodeURIComponent(surfaceId)}`,
          { method: 'DELETE' },
        )
      })
  }, [connection, surfaceId])

  const scheduleSave = useCallback((draft: ChatComposerDraft) => {
    latestDraftRef.current = draft
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      enqueue(hasContent(draft) ? draft : null)
    }, SAVE_DELAY_MS)
  }, [enqueue])

  const clearDraft = useCallback(() => {
    latestDraftRef.current = { files: [], text: '' }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    enqueue(null)
    setClearSignal(signal => signal + 1)
  }, [enqueue])

  useEffect(() => () => {
    if (!saveTimerRef.current) {
      return
    }
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    const draft = latestDraftRef.current
    enqueue(hasContent(draft) ? draft : null)
  }, [enqueue])

  const serverDraft = query.data?.draft
  const initialDraft: ChatComposerDraft = serverDraft
    ? { files: serverDraft.files as ChatComposerDraft['files'], text: serverDraft.text }
    : { files: [], text: '' }

  return {
    clearDraft,
    clearSignal,
    initialDraft,
    isPending: query.isPending && Boolean(connection) && enabled,
    scheduleSave,
  }
}
