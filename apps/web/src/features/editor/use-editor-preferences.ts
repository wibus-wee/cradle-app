// Favorite-editor preference + installed-editor discovery for the web UI.
// `listAvailableEditors` runs in the Electron main process (PATH + macOS .app
// detection); in the browser it is unavailable and the hooks degrade to empty.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { AvailableEditor } from '~/lib/electron'
import { nativeIpc } from '~/lib/electron'

const PREFERRED_EDITOR_KEY = 'cradle:preferred-editor'

export function useAvailableEditors() {
  return useQuery<AvailableEditor[]>({
    queryKey: ['native', 'available-editors'],
    queryFn: async () => {
      if (!nativeIpc?.native?.listAvailableEditors) {
        return []
      }
      return nativeIpc.native.listAvailableEditors()
    },
    staleTime: 5 * 60 * 1000,
  })
}

function readPreferredEditorId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  return window.localStorage.getItem(PREFERRED_EDITOR_KEY)
}

// Resolves the effective preferred editor: the stored choice if it is still
// available, otherwise the first available editor from the catalog order, or
// null when nothing is available. Returns a setter that persists the choice.
export function usePreferredEditor(available: AvailableEditor[]) {
  const [stored, setStored] = useState<string | null>(readPreferredEditorId)

  // Resync if another tab changed the preference.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === PREFERRED_EDITOR_KEY) {
        setStored(readPreferredEditorId())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const availableIds = new Set(available.map(editor => editor.id))
  const effective = stored && availableIds.has(stored)
    ? stored
    : available[0]?.id ?? null

  const setPreferred = (id: string | null) => {
    if (id) {
      window.localStorage.setItem(PREFERRED_EDITOR_KEY, id)
    }
    else {
      window.localStorage.removeItem(PREFERRED_EDITOR_KEY)
    }
    setStored(id)
  }

  return { preferredEditorId: effective, setPreferred }
}

export async function openInEditor(path: string, editorId?: string): Promise<string | null> {
  if (!nativeIpc?.native?.openPathInEditor) {
    return null
  }
  const result = await nativeIpc.native.openPathInEditor(path, editorId)
  return result.editor
}
