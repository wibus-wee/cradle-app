import type { RefObject } from 'react'
import { useEffect, useEffectEvent, useRef } from 'react'

export type SettingsSelectionShortcutAction
  = | 'select-visible'
    | 'clear-selection'
    | 'delete-selection'

type ShortcutKeyboardEvent = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat: boolean
  defaultPrevented: boolean
  target: EventTarget | null
}

export type SettingsSelectionShortcutState = {
  hasVisibleRecords: boolean
  hasSelection: boolean
  hasDraft: boolean
  canDeleteSelection: boolean
}

export type SettingsSelectionShortcutHandlers = SettingsSelectionShortcutState & {
  onSelectVisible: () => void
  onClearSelection: () => void
  onDeleteSelection: () => void
}

const OVERLAY_SELECTOR = [
  '[data-slot="dialog-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-agent-management-shortcut-ignore="true"]',
].join(', ')

function eventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return null
  }
  return target
}

export function shouldIgnoreSettingsSelectionShortcut(event: ShortcutKeyboardEvent): boolean {
  if (event.defaultPrevented) {
    return true
  }

  const target = eventTargetElement(event.target)
  if (!target) {
    return false
  }

  return (
    target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
    || target.isContentEditable
    || !!target.closest(OVERLAY_SELECTOR)
  )
}

export function getSettingsSelectionShortcutAction(
  event: ShortcutKeyboardEvent,
  state: SettingsSelectionShortcutState,
): SettingsSelectionShortcutAction | null {
  if (shouldIgnoreSettingsSelectionShortcut(event)) {
    return null
  }

  const key = event.key.toLowerCase()
  const isPlainKey = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey

  if (
    (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && key === 'a'
    && state.hasVisibleRecords
  ) {
    return 'select-visible'
  }

  if (key === 'escape' && isPlainKey && (state.hasSelection || state.hasDraft)) {
    return 'clear-selection'
  }

  if (
    (key === 'delete' || key === 'backspace')
    && isPlainKey
    && !event.repeat
    && state.hasSelection
    && state.canDeleteSelection
  ) {
    return 'delete-selection'
  }

  return null
}

export function useSettingsSelectionShortcuts({
  hasVisibleRecords,
  hasSelection,
  hasDraft,
  canDeleteSelection,
  onSelectVisible,
  onClearSelection,
  onDeleteSelection,
}: SettingsSelectionShortcutHandlers): RefObject<HTMLDivElement | null> {
  const shortcutScopeRef = useRef<HTMLDivElement>(null)
  const runShortcut = useEffectEvent((event: KeyboardEvent) => {
    const action = getSettingsSelectionShortcutAction(event, {
      canDeleteSelection,
      hasDraft,
      hasSelection,
      hasVisibleRecords,
    })

    if (!action) {
      return
    }

    event.preventDefault()

    if (action === 'select-visible') {
      onSelectVisible()
      return
    }

    if (action === 'clear-selection') {
      onClearSelection()
      return
    }

    onDeleteSelection()
  })

  useEffect(() => {
    const shortcutScope = shortcutScopeRef.current
    if (!shortcutScope) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      runShortcut(event)
    }

    shortcutScope.addEventListener('keydown', handleKeyDown)
    return () => shortcutScope.removeEventListener('keydown', handleKeyDown)
  }, [])

  return shortcutScopeRef
}
