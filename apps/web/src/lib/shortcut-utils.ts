type ShortcutModifiers = {
  mod?: boolean
  meta?: boolean
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export type ShortcutDefinition = ShortcutModifiers & {
  allowInEditable?: boolean
  key: string
}

export type ShortcutEntry = {
  id: string
  shortcut: ShortcutDefinition
  handler: () => void
  enabled: boolean
}

/** Physical key codes for non-letter shortcuts that may report unstable `event.key` values. */
const SHORTCUT_KEY_CODES: Record<string, string> = {
  '`': 'Backquote',
  '~': 'Backquote',
  'tab': 'Tab',
  'escape': 'Escape',
  'esc': 'Escape',
  'enter': 'Enter',
  'return': 'Enter',
  'backspace': 'Backspace',
  'delete': 'Delete',
  ' ': 'Space',
  'space': 'Space',
}

export function matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition): boolean {
  const key = shortcut.key.toLowerCase()
  const letterKeyCode = /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : null
  const namedKeyCode = SHORTCUT_KEY_CODES[key] ?? null
  const eventKey = event.key.toLowerCase()
  const keyMatched = eventKey === key
    || (letterKeyCode !== null && event.code === letterKeyCode)
    || (namedKeyCode !== null && event.code === namedKeyCode)
  if (!keyMatched) {
    return false
  }
  const modUsesMeta = navigator.platform.toLowerCase().includes('mac')
  const expectedMeta = Boolean(shortcut.meta) || Boolean(shortcut.mod && modUsesMeta)
  const expectedCtrl = Boolean(shortcut.ctrl) || Boolean(shortcut.mod && !modUsesMeta)
  if (expectedMeta !== event.metaKey) {
    return false
  }
  if (expectedCtrl !== event.ctrlKey) {
    return false
  }
  if (!!shortcut.shift !== event.shiftKey) {
    return false
  }
  if (!!shortcut.alt !== event.altKey) {
    return false
  }
  return true
}

/**
 * Serializes a shortcut definition to a human-readable string.
 * Useful for display in tooltips, menus, etc.
 */
function _formatShortcut(shortcut: ShortcutDefinition): string {
  const parts: string[] = []
  if (shortcut.ctrl) {
    parts.push('Ctrl')
  }
  if (shortcut.alt) {
    parts.push('Alt')
  }
  if (shortcut.shift) {
    parts.push('Shift')
  }
  if (shortcut.meta) {
    parts.push('⌘')
  }
  parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key)
  return parts.join('+')
}
