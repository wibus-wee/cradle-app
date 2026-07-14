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

export function matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition): boolean {
  const key = shortcut.key.toLowerCase()
  if (event.key.toLowerCase() !== key) {
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
