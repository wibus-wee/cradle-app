export const VSCODE_COPY_PATH_SHORTCUT = '⌘K P'
export const VSCODE_COPY_RELATIVE_PATH_SHORTCUT = '⌘⇧⌥C'
export const WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE = 'data-workspace-file-shortcut-scope'

export function isWorkspaceFileShortcutScopeEvent(event: Event): boolean {
  for (const entry of event.composedPath()) {
    if (
      entry instanceof HTMLElement
      && entry.getAttribute(WORKSPACE_FILE_SHORTCUT_SCOPE_ATTRIBUTE) === 'true'
    ) {
      return true
    }
  }
  return false
}

export function isCopyPathShortcut(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p'
}

export function isCopyPathChordStart(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k'
}

export function isCopyRelativePathShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.altKey && event.shiftKey && event.key.toLowerCase() === 'c'
}
