import type { ITheme } from '@xterm/xterm'

const DARK_FALLBACK: ITheme = {
  background: '#191919',
  foreground: '#f5f5f5',
  cursor: '#f5f5f5',
  cursorAccent: '#191919',
  selectionBackground: 'rgba(245, 245, 245, 0.22)',
  selectionForeground: '#ffffff',
  black: '#191919',
  red: '#f87171',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#d4d4d4',
  brightBlack: '#737373',
  brightRed: '#fca5a5',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
}

const LIGHT_FALLBACK: ITheme = {
  background: '#ffffff',
  foreground: '#333333',
  cursor: '#333333',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  selectionForeground: '#000000',
  black: '#262626',
  red: '#dc2626',
  green: '#059669',
  yellow: '#a16207',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#d4d4d4',
  brightBlack: '#737373',
  brightRed: '#ef4444',
  brightGreen: '#10b981',
  brightYellow: '#ca8a04',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
}

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

function resolveCssColor(cssColor: string, fallback: string, property: 'color' | 'backgroundColor' = 'color'): string {
  if (!document.body) {
    return fallback
  }

  const probe = document.createElement('span')
  probe.style.position = 'fixed'
  probe.style.pointerEvents = 'none'
  probe.style.opacity = '0'
  probe.style[property] = cssColor
  document.body.append(probe)
  const resolved = getComputedStyle(probe)[property]
  probe.remove()
  return !resolved || resolved.includes('var(') || resolved.includes('color-mix(')
    ? fallback
    : resolved
}

function themeColor(variable: string, fallback: string): string {
  const explicit = document.documentElement.style.getPropertyValue(variable).trim()
  if (/^#[0-9a-f]{3,8}$/i.test(explicit)) {
    return explicit
  }
  return resolveCssColor(explicit || `var(${variable})`, fallback)
}

function themeBackground(variable: string, fallback: string): string {
  const explicit = document.documentElement.style.getPropertyValue(variable).trim()
  if (/^#[0-9a-f]{3,8}$/i.test(explicit)) {
    return explicit
  }
  return resolveCssColor(explicit || `var(${variable})`, fallback, 'backgroundColor')
}

/** Build xterm colours from the same resolved CSS tokens as the surrounding app. */
export function getAppTerminalTheme(): ITheme {
  const fallback = isDarkTheme() ? DARK_FALLBACK : LIGHT_FALLBACK
  const background = themeBackground('--background', fallback.background!)
  const foreground = themeColor('--foreground', fallback.foreground!)
  const explicitAccent = document.documentElement.style.getPropertyValue('--primary').trim()
  const explicitForeground = document.documentElement.style.getPropertyValue('--foreground').trim()

  return {
    background,
    foreground,
    cursor: themeColor('--primary', fallback.cursor!),
    cursorAccent: background,
    selectionBackground: /^#[0-9a-f]{6}$/i.test(explicitAccent)
      ? `${explicitAccent}66`
      : resolveCssColor(
          'color-mix(in srgb, var(--primary) 28%, transparent)',
          fallback.selectionBackground!,
          'backgroundColor',
        ),
    selectionForeground: explicitForeground ? foreground : fallback.selectionForeground,
    black: themeColor('--foreground', fallback.black!),
    red: themeColor('--destructive', fallback.red!),
    green: themeColor('--chart-2', fallback.green!),
    yellow: themeColor('--chart-4', fallback.yellow!),
    blue: themeColor('--chart-1', fallback.blue!),
    magenta: themeColor('--chart-5', fallback.magenta!),
    cyan: themeColor('--chart-3', fallback.cyan!),
    white: themeColor('--muted-foreground', fallback.white!),
    brightBlack: themeColor('--muted-foreground', fallback.brightBlack!),
    brightRed: resolveCssColor('color-mix(in srgb, var(--destructive) 76%, white)', fallback.brightRed!),
    brightGreen: resolveCssColor('color-mix(in srgb, var(--chart-2) 76%, white)', fallback.brightGreen!),
    brightYellow: resolveCssColor('color-mix(in srgb, var(--chart-4) 76%, white)', fallback.brightYellow!),
    brightBlue: resolveCssColor('color-mix(in srgb, var(--chart-1) 76%, white)', fallback.brightBlue!),
    brightMagenta: resolveCssColor('color-mix(in srgb, var(--chart-5) 76%, white)', fallback.brightMagenta!),
    brightCyan: resolveCssColor('color-mix(in srgb, var(--chart-3) 76%, white)', fallback.brightCyan!),
    brightWhite: themeColor('--foreground', fallback.brightWhite!),
  }
}

export function watchTerminalTheme(onChange: () => void): () => void {
  let frame: number | null = null
  const observer = new MutationObserver(() => {
    if (frame !== null) {
      return
    }
    frame = requestAnimationFrame(() => {
      frame = null
      onChange()
    })
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme-profile', 'data-theme-code-font', 'style'],
  })
  return () => {
    if (frame !== null) {
      cancelAnimationFrame(frame)
    }
    observer.disconnect()
  }
}
