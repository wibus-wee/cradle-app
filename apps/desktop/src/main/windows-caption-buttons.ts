import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import type { BrowserWindow } from 'electron'
import { app } from 'electron'

import { resolveStagedNativeAddonPath } from './native-addon-paths'

export interface CaptionButtonRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CaptionButtonRectsInput {
  minimize?: CaptionButtonRect
  maximize?: CaptionButtonRect
  close?: CaptionButtonRect
}

export interface CaptionButtonHoverEvent {
  button: 'minimize' | 'maximize' | 'close'
  phase: 'enter' | 'leave' | 'press' | 'release'
}

interface CaptionButtonsAddon {
  attach: (handle: Buffer, onHover: (event: { button: string, phase: string }) => void) => boolean
  beginWindowDrag: (handle: Buffer) => boolean
  detach: (handle: Buffer) => boolean
  setButtons: (handle: Buffer, buttons: CaptionButtonRectsInput) => boolean
}

const require = createRequire(import.meta.url)

let cachedAddon: CaptionButtonsAddon | null | undefined

function resolveAddonCandidates(): string[] {
  const appPath = app.getAppPath()
  const candidates: string[] = []
  candidates.push(resolveStagedNativeAddonPath(appPath, 'caption-buttons.node'))
  if (!app.isPackaged) {
    candidates.push(
      join(appPath, 'native', 'windows', 'caption-buttons', 'build', 'Release', 'caption_buttons.node'),
    )
  }
  return candidates
}

function loadCaptionButtonsAddon(): CaptionButtonsAddon | null {
  if (cachedAddon !== undefined) {
    return cachedAddon
  }
  for (const candidate of resolveAddonCandidates()) {
    try {
      if (!existsSync(candidate)) {
        continue
      }

      cachedAddon = require(candidate) as CaptionButtonsAddon
      return cachedAddon
    }
    catch (error) {
      console.warn(`[desktop] failed to load caption-buttons addon at ${candidate}:`, error)
    }
  }
  if (process.platform === 'win32') {
    console.warn('[desktop] caption-buttons addon unavailable; falling back to renderer-driven window controls')
  }
  cachedAddon = null
  return cachedAddon
}

function readWindowHandle(win: BrowserWindow): Buffer | null {
  if (win.isDestroyed()) {
    return null
  }
  return win.getNativeWindowHandle()
}

/**
 * Attach native caption-button hit-testing to a frameless BrowserWindow on
 * Windows. The system then treats the renderer-drawn button rects as real
 * non-client caption buttons (hover tooltips, Snap Layouts flyout, clicks).
 * No-op on other platforms or when the addon is unavailable.
 */
export function installWindowsCaptionButtons(win: BrowserWindow): void {
  if (process.platform !== 'win32') {
    return
  }
  const addon = loadCaptionButtonsAddon()
  const handle = readWindowHandle(win)
  if (!addon || handle === null) {
    return
  }

  const attached = addon.attach(handle, (event) => {
    if (!win.isDestroyed()) {
      win.webContents.send('window:caption-hover', event)
    }
  })
  if (!attached) {
    return
  }

  win.on('maximize', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window:maximized-changed', true)
    }
  })
  win.on('unmaximize', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window:maximized-changed', false)
    }
  })
  win.once('closed', () => {
    addon.detach(handle)
  })
}

/** Continue the currently held left button as a native non-client window drag. */
export function beginWindowsWindowDrag(win: BrowserWindow): boolean {
  if (process.platform !== 'win32') {
    return false
  }
  const addon = loadCaptionButtonsAddon()
  const handle = readWindowHandle(win)
  return addon && handle ? addon.beginWindowDrag(handle) : false
}

/**
 * Push renderer-measured caption button rects (physical pixels relative to
 * the window client area) into the native hit-test layer.
 */
export function applyWindowsCaptionButtonRects(
  win: BrowserWindow,
  rects: CaptionButtonRectsInput,
): void {
  if (process.platform !== 'win32') {
    return
  }
  const addon = loadCaptionButtonsAddon()
  const handle = readWindowHandle(win)
  if (!addon || handle === null) {
    return
  }
  addon.setButtons(handle, rects)
}
