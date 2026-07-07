export type DesktopWindowControlsSide = 'left' | 'right' | 'none'

export interface DesktopWindowControlsSafeArea {
  side: DesktopWindowControlsSide
  x: number
  y: number
  width: number
  height: number
}

export const MACOS_WINDOW_CONTROLS_SAFE_AREA: DesktopWindowControlsSafeArea = {
  side: 'left',
  x: 16,
  y: 18,
  width: 70,
  height: 44
}

export const WINDOWS_WINDOW_CONTROLS_SAFE_AREA: DesktopWindowControlsSafeArea = {
  side: 'right',
  x: 0,
  y: 0,
  width: 130,
  height: 50
}

export const LINUX_WINDOW_CONTROLS_SAFE_AREA: DesktopWindowControlsSafeArea = {
  side: 'right',
  x: 0,
  y: 0,
  width: 90,
  height: 50
}

export function resolveWindowControlsSafeArea(
  platform: NodeJS.Platform
): DesktopWindowControlsSafeArea {
  if (platform === 'darwin') {
    return MACOS_WINDOW_CONTROLS_SAFE_AREA
  }
  if (platform === 'win32') {
    return WINDOWS_WINDOW_CONTROLS_SAFE_AREA
  }
  return LINUX_WINDOW_CONTROLS_SAFE_AREA
}

export function resolveTrafficLightPosition(safeArea = MACOS_WINDOW_CONTROLS_SAFE_AREA): {
  x: number
  y: number
} {
  return {
    x: safeArea.x,
    y: safeArea.y
  }
}

const DESKTOP_WINDOW_CONTROLS_BACKGROUND = {
  light: '#efefef',
  dark: '#141414'
} as const

const DESKTOP_WINDOW_CONTROLS_SYMBOL = {
  light: '#262626',
  dark: '#f5f5f5'
} as const

export function resolveWindowControlsOverlay(
  shouldUseDarkColors: boolean,
  safeArea: DesktopWindowControlsSafeArea
): { color: string; symbolColor: string; height: number } {
  const theme = shouldUseDarkColors ? 'dark' : 'light'
  return {
    color: DESKTOP_WINDOW_CONTROLS_BACKGROUND[theme],
    symbolColor: DESKTOP_WINDOW_CONTROLS_SYMBOL[theme],
    height: safeArea.height
  }
}
