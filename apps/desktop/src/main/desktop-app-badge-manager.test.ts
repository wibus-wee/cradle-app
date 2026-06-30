// Verifies desktop-owned app icon badge IPC and macOS Dock badge projection.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const ipcHandlers = new Map<string, Listener>()

  return {
    app: {
      dock: {
        setBadge: vi.fn(),
      },
    },
    ipcHandlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Listener) => {
        ipcHandlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        ipcHandlers.delete(channel)
      }),
    },
  }
})

vi.mock('electron', () => electronMocks)

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  })
}

describe('desktopAppBadgeManager', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    electronMocks.ipcHandlers.clear()
    electronMocks.app.dock.setBadge.mockClear()
    electronMocks.ipcMain.handle.mockClear()
    electronMocks.ipcMain.removeHandler.mockClear()
    setPlatform('darwin')
  })

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  it('registers unread-count IPC and projects normalized counts to the macOS Dock badge', async () => {
    const { DesktopAppBadgeManager, DESKTOP_APP_BADGE_UNREAD_COUNT_CHANNEL } = await import('./desktop-app-badge-manager')
    const manager = new DesktopAppBadgeManager()

    manager.initialize()
    expect(electronMocks.ipcMain.handle).toHaveBeenCalledWith(
      DESKTOP_APP_BADGE_UNREAD_COUNT_CHANNEL,
      expect.any(Function),
    )
    expect(electronMocks.app.dock.setBadge).toHaveBeenLastCalledWith('')

    manager.setUnreadCount(2.8)
    expect(electronMocks.app.dock.setBadge).toHaveBeenLastCalledWith('2')

    manager.setUnreadCount(-1)
    expect(electronMocks.app.dock.setBadge).toHaveBeenLastCalledWith('')

    manager.destroy()
    expect(electronMocks.ipcMain.removeHandler).toHaveBeenCalledWith(DESKTOP_APP_BADGE_UNREAD_COUNT_CHANNEL)
    expect(electronMocks.app.dock.setBadge).toHaveBeenLastCalledWith('')
  })

  it('ignores badge writes on non-macOS platforms', async () => {
    const { DesktopAppBadgeManager } = await import('./desktop-app-badge-manager')
    const manager = new DesktopAppBadgeManager()

    setPlatform('linux')
    manager.setUnreadCount(3)

    expect(electronMocks.app.dock.setBadge).not.toHaveBeenCalled()
  })
})
