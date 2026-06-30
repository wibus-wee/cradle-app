import type { SettingsKey } from '~/features/settings/settings-key'

/**
 * A single key-binding entry in the built-in shortcuts reference.
 *
 * `keys` holds pre-formatted, display-ready cap strings (e.g. `'⌘K'`,
 * `'⇧⌘P'`, `'Ctrl Tab'`). Multiple entries are alternatives; a single entry
 * may itself be a chord. The strings are intentionally pre-resolved so every
 * surface that renders the reference (Settings page, `Cmd+/` overlay) shows
 * identical glyphs.
 */
export interface BuiltInShortcutItem {
  labelKey: SettingsKey
  descriptionKey: SettingsKey
  keys: readonly string[]
}

export interface BuiltInShortcutGroup {
  labelKey: SettingsKey
  descriptionKey: SettingsKey
  items: readonly BuiltInShortcutItem[]
}

/**
 * The authoritative catalog of Cradle's key bindings.
 *
 * Owned by the `shortcuts` feature. This is the single source of truth for
 * what bindings exist (web-level + native/Electron-level) — consumers render
 * it, they never re-derive it. See `docs/design-system` for the visual
 * language applied when rendering these.
 */
export const BUILT_IN_SHORTCUT_GROUPS: readonly BuiltInShortcutGroup[] = [
  {
    labelKey: 'shortcut.builtIn.global.title',
    descriptionKey: 'shortcut.builtIn.global.description',
    items: [
      {
        labelKey: 'shortcut.builtIn.keyboardShortcuts.label',
        descriptionKey: 'shortcut.builtIn.keyboardShortcuts.description',
        keys: ['⌘/'],
      },
      {
        labelKey: 'shortcut.builtIn.settings.label',
        descriptionKey: 'shortcut.builtIn.settings.description',
        keys: ['⌘,'],
      },
      {
        labelKey: 'shortcut.builtIn.commandPalette.label',
        descriptionKey: 'shortcut.builtIn.commandPalette.description',
        keys: ['⌘K', '⇧⌘P'],
      },
      {
        labelKey: 'shortcut.builtIn.quickOpen.label',
        descriptionKey: 'shortcut.builtIn.quickOpen.description',
        keys: ['⌘P'],
      },
      {
        labelKey: 'shortcut.builtIn.newChat.label',
        descriptionKey: 'shortcut.builtIn.newChat.description',
        keys: ['⌘T'],
      },
      {
        labelKey: 'shortcut.builtIn.closeSurface.label',
        descriptionKey: 'shortcut.builtIn.closeSurface.description',
        keys: ['⌘W'],
      },
      {
        labelKey: 'shortcut.builtIn.switchSurface.label',
        descriptionKey: 'shortcut.builtIn.switchSurface.description',
        keys: ['⌘1-⌘9'],
      },
      {
        labelKey: 'shortcut.builtIn.cycleSurface.label',
        descriptionKey: 'shortcut.builtIn.cycleSurface.description',
        keys: ['Ctrl Tab', 'Ctrl ⇧Tab'],
      },
      {
        labelKey: 'shortcut.builtIn.sidebar.label',
        descriptionKey: 'shortcut.builtIn.sidebar.description',
        keys: ['⌘B'],
      },
      {
        labelKey: 'shortcut.builtIn.rightAside.label',
        descriptionKey: 'shortcut.builtIn.rightAside.description',
        keys: ['⌘⌥B'],
      },
      {
        labelKey: 'shortcut.builtIn.bottomPanel.label',
        descriptionKey: 'shortcut.builtIn.bottomPanel.description',
        keys: ['Ctrl `'],
      },
      {
        labelKey: 'shortcut.builtIn.externalTerminal.label',
        descriptionKey: 'shortcut.builtIn.externalTerminal.description',
        keys: ['⇧⌘C', 'Ctrl ⇧C'],
      },
      {
        labelKey: 'shortcut.builtIn.jarvis.label',
        descriptionKey: 'shortcut.builtIn.jarvis.description',
        keys: ['⌘J'],
      },
      {
        labelKey: 'shortcut.builtIn.layoutFocus.label',
        descriptionKey: 'shortcut.builtIn.layoutFocus.description',
        keys: ['⌘.'],
      },
    ],
  },
  {
    labelKey: 'shortcut.builtIn.contextual.title',
    descriptionKey: 'shortcut.builtIn.contextual.description',
    items: [
      {
        labelKey: 'shortcut.builtIn.settingsClose.label',
        descriptionKey: 'shortcut.builtIn.settingsClose.description',
        keys: ['⌘Esc'],
      },
      {
        labelKey: 'shortcut.builtIn.chatSend.label',
        descriptionKey: 'shortcut.builtIn.chatSend.description',
        keys: ['Enter'],
      },
      {
        labelKey: 'shortcut.builtIn.chatAlternateSend.label',
        descriptionKey: 'shortcut.builtIn.chatAlternateSend.description',
        keys: ['⇧⌘↵', '⇧Ctrl↵'],
      },
      {
        labelKey: 'shortcut.builtIn.chatMode.label',
        descriptionKey: 'shortcut.builtIn.chatMode.description',
        keys: ['⇧Tab'],
      },
      {
        labelKey: 'shortcut.builtIn.browserTabSwitch.label',
        descriptionKey: 'shortcut.builtIn.browserTabSwitch.description',
        keys: ['⌘1-⌘9', '⌘0'],
      },
      {
        labelKey: 'shortcut.builtIn.browserTabClose.label',
        descriptionKey: 'shortcut.builtIn.browserTabClose.description',
        keys: ['⌘W'],
      },
      {
        labelKey: 'shortcut.builtIn.workspaceCopyPath.label',
        descriptionKey: 'shortcut.builtIn.workspaceCopyPath.description',
        keys: ['P', '⌘K P'],
      },
      {
        labelKey: 'shortcut.builtIn.workspaceCopyRelativePath.label',
        descriptionKey: 'shortcut.builtIn.workspaceCopyRelativePath.description',
        keys: ['⌘⇧⌥C'],
      },
    ],
  },
]
