import * as React from 'react'

import { readKeybindings } from '~/features/shortcuts/api/keybindings'
import type { KeybindingContext, KeybindingRule, ResolvedKeybindingRule } from '~/keybindings'
import { evaluateWhenExpression, resolveKeybindingRules } from '~/keybindings'

import { ShortcutContext } from './shortcut-context'
import type { ShortcutDefinition, ShortcutEntry } from './shortcut-utils'
import { matchesShortcut } from './shortcut-utils'

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
    || target.isContentEditable
  )
}

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const entriesRef = React.useRef<Map<string, ShortcutEntry>>(new Map())
  const configuredRulesRef = React.useRef<ResolvedKeybindingRule[]>([])

  const register = React.useCallback(
    (id: string, shortcut: ShortcutDefinition, handler: () => void, enabled = true) => {
      entriesRef.current.set(id, { id, shortcut, handler, enabled })
    },
    [],
  )

  const unregister = React.useCallback((id: string) => {
    entriesRef.current.delete(id)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void readKeybindings()
      .then((data) => {
        if (cancelled || !data) {
          return
        }
        if (data.errors.length > 0) {
          console.warn(`[keybindings] ${data.configPath}: ${data.errors.join('; ')}`)
        }
        configuredRulesRef.current = (data.rules as KeybindingRule[]).flatMap((rule) => {
          try {
            return resolveKeybindingRules([rule])
          }
 catch (error) {
            console.warn(`[keybindings] Invalid rule for ${rule.command}`, error)
            return []
          }
        })
      })
      .catch((error) => {
        console.warn('[keybindings] Failed to load keybindings configuration', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return
      }

      const editableTarget = isEditableShortcutTarget(event.target)
      const target = event.target instanceof HTMLElement ? event.target : null
      const context: KeybindingContext = {
        editableFocus: editableTarget,
        inputFocus: target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA',
        terminalFocus: Boolean(target?.closest('.xterm, [data-terminal], [data-terminal-pane]')),
        dialogOpen: document.querySelector('[role="dialog"][aria-modal="true"]') !== null,
        isMac: navigator.platform.toLowerCase().includes('mac'),
      }
      for (const entry of entriesRef.current.values()) {
        if (!entry.enabled) {
          continue
        }
        const configuredRule = configuredRulesRef.current
          .filter(rule => rule.command === entry.id && (!rule.when || evaluateWhenExpression(rule.when, context)))
          .at(-1)
        const shortcut = configuredRule?.shortcut ?? entry.shortcut
        if (editableTarget && !shortcut.allowInEditable) {
          continue
        }
        if (matchesShortcut(event, shortcut)) {
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

  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>
}
