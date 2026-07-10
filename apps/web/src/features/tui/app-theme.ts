import type { ITheme } from '@xterm/xterm'

const DARK_ANSI_THEME = {
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
} satisfies Partial<ITheme>

const LIGHT_ANSI_THEME = {
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
} satisfies Partial<ITheme>

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

function readThemeOverride(property: string): string | null {
  const value = document.documentElement.style.getPropertyValue(property).trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value : null
}

/**
 * Build an xterm ITheme from the app's current surface tokens plus a terminal-native ANSI palette.
 * Call this at mount-time and on dark/light changes to keep the terminal
 * colours in sync with the rest of the UI.
 */
export function getAppTerminalTheme(): ITheme {
  const dark = isDarkTheme()
  const background = readThemeOverride('--background') ?? (dark ? '#0c0c0c' : '#ffffff')
  const foreground = readThemeOverride('--foreground') ?? (dark ? '#cccccc' : '#333333')
  const accent = readThemeOverride('--primary')

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: accent ? `${accent}66` : dark ? '#264f78' : '#add6ff',
    selectionForeground: accent ? foreground : dark ? '#ffffff' : '#000000',
    ...(dark ? DARK_ANSI_THEME : LIGHT_ANSI_THEME),
  }
}

export function watchTerminalTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme-profile', 'data-theme-code-font', 'style'],
  })
  return () => observer.disconnect()
}
