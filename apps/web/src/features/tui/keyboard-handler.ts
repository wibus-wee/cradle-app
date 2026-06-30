import type { Terminal } from '@xterm/xterm'

/**
 * Attach macOS-style keyboard shortcut bindings to an xterm terminal.
 *
 * Maps:
 *   Cmd+Delete      → Ctrl+U  (kill line to start)
 *   Cmd+←           → Home    (beginning of line)
 *   Cmd+→           → End     (end of line)
 *   Option+←        → Alt+B   (word backward, readline)
 *   Option+→        → Alt+F   (word forward, readline)
 *   Cmd+Backspace   → Ctrl+W  (delete word backward, fallback for some shells)
 */
export function attachMacKeyboardHandler(terminal: Terminal): void {
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.type !== 'keydown') {
      return true
    }

    // Cmd+Delete or Cmd+Backspace → kill to beginning of line (Ctrl+U)
    if (event.metaKey && (event.key === 'Backspace' || event.key === 'Delete')) {
      terminal.input('\x15')
      return false
    }

    // Cmd+← → beginning of line
    if (event.metaKey && event.key === 'ArrowLeft') {
      terminal.input('\x1BOH')
      return false
    }

    // Cmd+→ → end of line
    if (event.metaKey && event.key === 'ArrowRight') {
      terminal.input('\x1BOF')
      return false
    }

    // Option+← → word backward (readline Alt+B)
    if (event.altKey && event.key === 'ArrowLeft') {
      terminal.input('\x1BB')
      return false
    }

    // Option+→ → word forward (readline Alt+F)
    if (event.altKey && event.key === 'ArrowRight') {
      terminal.input('\x1BF')
      return false
    }

    return true
  })
}
