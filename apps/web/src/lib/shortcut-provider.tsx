import * as React from 'react'

import { ShortcutContext } from './shortcut-context'
import type { ShortcutDefinition, ShortcutEntry } from './shortcut-utils'
import { matchesShortcut } from './shortcut-utils'

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
    || target.isContentEditable
}

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const entriesRef = React.useRef<Map<string, ShortcutEntry>>(new Map())

  const register = React.useCallback((id: string, shortcut: ShortcutDefinition, handler: () => void, enabled = true) => {
    entriesRef.current.set(id, { id, shortcut, handler, enabled })
  }, [])

  const unregister = React.useCallback((id: string) => {
    entriesRef.current.delete(id)
  }, [])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return
      }

      const editableTarget = isEditableShortcutTarget(event.target)
      for (const entry of entriesRef.current.values()) {
        if (!entry.enabled) {
          continue
        }
        if (editableTarget && !entry.shortcut.allowInEditable) {
          continue
        }
        if (matchesShortcut(event, entry.shortcut)) {
          event.preventDefault()
          entry.handler()
          return
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  const value = React.useMemo(() => ({ register, unregister }), [register, unregister])

  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  )
}
