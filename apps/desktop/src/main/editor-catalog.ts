// Editor catalog: launch metadata for supported code editors / terminals / file
// managers. Ported from synara's @synara/contracts editor catalog (plain TS -
// no schema lib). Used by native-editor-launcher for detection + launch.
//
// launchStyle governs how a target path is turned into CLI args:
//   - direct-path: pass the path verbatim (Zed, Sublime, Xcode)
//   - goto: VS Code family (--goto path:line:col) - bare path works too
//   - line-column: JetBrains (--line N --column C path) - bare path works too
//   - terminal-working-directory: resolve to a directory, pass as cwd arg
// Cradle currently opens directory/worktree paths (no line:col), so direct-path
// and goto/line-column all reduce to `cmd <path>`; terminal style resolves to a
// directory first.

export type EditorLaunchStyle = 'direct-path' | 'goto' | 'line-column' | 'terminal-working-directory'

export interface EditorDefinition {
  readonly id: string
  readonly label: string
  /** CLI commands to try in order, or null for non-CLI editors (file-manager, system-default). */
  readonly commands: readonly string[] | null
  /** macOS .app bundle names to look for in /Applications, ~/Applications, JetBrains Toolbox. */
  readonly macApplications?: readonly string[]
  readonly launchStyle: EditorLaunchStyle
}

export const EDITORS: readonly EditorDefinition[] = [
  { id: 'cursor', label: 'Cursor', commands: ['cursor'], macApplications: ['Cursor'], launchStyle: 'goto' },
  { id: 'trae', label: 'Trae', commands: ['trae'], macApplications: ['Trae'], launchStyle: 'goto' },
  { id: 'vscode', label: 'VS Code', commands: ['code'], macApplications: ['Visual Studio Code'], launchStyle: 'goto' },
  { id: 'vscode-insiders', label: 'VS Code Insiders', commands: ['code-insiders'], macApplications: ['Visual Studio Code - Insiders'], launchStyle: 'goto' },
  { id: 'vscodium', label: 'VSCodium', commands: ['codium'], macApplications: ['VSCodium'], launchStyle: 'goto' },
  { id: 'zed', label: 'Zed', commands: ['zed', 'zeditor'], macApplications: ['Zed'], launchStyle: 'direct-path' },
  { id: 'windsurf', label: 'Windsurf', commands: ['windsurf'], macApplications: ['Windsurf'], launchStyle: 'goto' },
  { id: 'sublime', label: 'Sublime Text', commands: ['subl'], macApplications: ['Sublime Text'], launchStyle: 'direct-path' },
  { id: 'antigravity', label: 'Antigravity', commands: ['agy'], macApplications: ['Antigravity'], launchStyle: 'goto' },
  { id: 'xcode', label: 'Xcode', commands: ['xed'], macApplications: ['Xcode'], launchStyle: 'direct-path' },
  {
    id: 'idea',
    label: 'IntelliJ IDEA',
    commands: ['idea', 'idea64', 'idea.sh', 'intellij-idea'],
    macApplications: ['IntelliJ IDEA', 'IntelliJ IDEA Ultimate', 'IntelliJ IDEA Community Edition', 'IntelliJ IDEA CE'],
    launchStyle: 'line-column',
  },
  { id: 'webstorm', label: 'WebStorm', commands: ['webstorm', 'wstorm', 'webstorm64', 'webstorm.sh'], macApplications: ['WebStorm'], launchStyle: 'line-column' },
  { id: 'pycharm', label: 'PyCharm', commands: ['pycharm', 'charm', 'pycharm64', 'pycharm.sh', 'pycharm-professional'], macApplications: ['PyCharm', 'PyCharm Professional', 'PyCharm CE'], launchStyle: 'line-column' },
  { id: 'goland', label: 'GoLand', commands: ['goland', 'goland64', 'goland.sh'], macApplications: ['GoLand'], launchStyle: 'line-column' },
  { id: 'clion', label: 'CLion', commands: ['clion', 'clion64', 'clion.sh'], macApplications: ['CLion'], launchStyle: 'line-column' },
  { id: 'rustrover', label: 'RustRover', commands: ['rustrover', 'rustrover64', 'rustrover.sh'], macApplications: ['RustRover'], launchStyle: 'line-column' },
  { id: 'android-studio', label: 'Android Studio', commands: ['studio', 'android-studio', 'studio.sh'], macApplications: ['Android Studio'], launchStyle: 'line-column' },
  { id: 'ghostty', label: 'Ghostty', commands: ['ghostty'], macApplications: ['Ghostty'], launchStyle: 'terminal-working-directory' },
  { id: 'warp', label: 'Warp', commands: ['warp'], macApplications: ['Warp'], launchStyle: 'terminal-working-directory' },
  {
    id: 'terminal',
    label: 'Terminal',
    commands: ['wt', 'gnome-terminal', 'kgx', 'konsole', 'xfce4-terminal', 'tilix', 'x-terminal-emulator', 'kitty', 'alacritty', 'wezterm'],
    macApplications: ['Terminal', 'iTerm'],
    launchStyle: 'terminal-working-directory',
  },
  { id: 'file-manager', label: 'File Manager', commands: null, launchStyle: 'direct-path' },
  // Opens the target with the OS default handler (Preview for PDFs on macOS, etc.).
  // No commands/macApplications of its own; launched via the OS `open`/`start`/`xdg-open`.
  { id: 'system-default', label: 'Default app', commands: null, launchStyle: 'direct-path' },
]

export type EditorId = (typeof EDITORS)[number]['id']

export const EDITOR_IDS: readonly EditorId[] = EDITORS.map(editor => editor.id)

export function findEditor(id: string): EditorDefinition | undefined {
  return EDITORS.find(editor => editor.id === id)
}
