import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopUpdateInfo } from './update-types'

const electronMocks = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => '1.2.2'),
    isPackaged: true,
  },
}))

const sparkleMocks = vi.hoisted(() => {
  const state = {
    ready: true,
    initError: null as string | null,
    updateInfo: null as DesktopUpdateInfo | null,
    instances: [] as Array<{
      initialize: ReturnType<typeof vi.fn>
      setAutomaticChecks: ReturnType<typeof vi.fn>
      checkForUpdatesWithUI: ReturnType<typeof vi.fn>
      probeForUpdate: ReturnType<typeof vi.fn>
      installUpdateNow: ReturnType<typeof vi.fn>
      isReady: boolean
      lastInitError: string | null
    }>,
  }

  class MacOSSparkleUpdateAdapter {
    initialize = vi.fn(async () => ({ ready: state.ready, errorMessage: state.initError }))
    setAutomaticChecks = vi.fn()
    checkForUpdatesWithUI = vi.fn()
    probeForUpdate = vi.fn(async () => state.updateInfo)
    installUpdateNow = vi.fn()

    get isReady() {
      return state.ready
    }

    get lastInitError() {
      return state.initError
    }

    constructor() {
      state.instances.push(this)
    }
  }

  return {
    MacOSSparkleUpdateAdapter,
    state,
  }
})

const electronUpdaterMocks = vi.hoisted(() => {
  type Listener = (...args: object[]) => void

  class FakeAutoUpdater {
    autoDownload = true
    autoInstallOnAppQuit = true
    allowPrerelease = false
    disableWebInstaller = false
    logger: Console | null = null
    readonly listeners = new Map<string, Listener[]>()
    readonly setFeedURL = vi.fn()
    readonly checkForUpdates = vi.fn()
    readonly downloadUpdate = vi.fn()
    readonly quitAndInstall = vi.fn()
    readonly on = vi.fn((event: string, listener: Listener) => {
      const eventListeners = this.listeners.get(event) ?? []
      eventListeners.push(listener)
      this.listeners.set(event, eventListeners)
      return this
    })

    emit(event: string, ...args: object[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args)
      }
    }

    reset(): void {
      this.autoDownload = true
      this.autoInstallOnAppQuit = true
      this.allowPrerelease = false
      this.disableWebInstaller = false
      this.logger = null
      this.listeners.clear()
      this.setFeedURL.mockReset()
      this.checkForUpdates.mockReset()
      this.downloadUpdate.mockReset()
      this.quitAndInstall.mockReset()
      this.on.mockClear()
    }
  }

  const autoUpdater = new FakeAutoUpdater()
  class CancellationToken {
    cancelled = false
    cancel() {
      this.cancelled = true
    }
  }

  return {
    autoUpdater,
    CancellationToken,
  }
})

vi.mock('electron', () => electronMocks)

vi.mock('./macos-sparkle-update-adapter', () => ({
  MacOSSparkleUpdateAdapter: sparkleMocks.MacOSSparkleUpdateAdapter,
}))

vi.mock('electron-updater', () => ({
  autoUpdater: electronUpdaterMocks.autoUpdater,
  CancellationToken: electronUpdaterMocks.CancellationToken,
}))

describe('desktopUpdateManager', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetModules()
    electronMocks.app.getVersion.mockReturnValue('1.2.2')
    electronMocks.app.isPackaged = true
    sparkleMocks.state.ready = true
    sparkleMocks.state.initError = null
    sparkleMocks.state.updateInfo = null
    sparkleMocks.state.instances = []
    electronUpdaterMocks.autoUpdater.reset()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    process.env.CRADLE_DESKTOP_UPDATE_URL = 'https://updates.example.com/cradle/appcast.xml'
    process.env.CRADLE_DESKTOP_SPARKLE_APPCAST_URL = 'https://updates.example.com/cradle/appcast.xml'
    process.env.SPARKLE_ED_PUBLIC_KEY = 'test-public-key'
    delete process.env.CRADLE_DESKTOP_ALLOW_DEV_UPDATES
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    delete process.env.CRADLE_DESKTOP_UPDATE_URL
    delete process.env.CRADLE_DESKTOP_SPARKLE_APPCAST_URL
    delete process.env.SPARKLE_ED_PUBLIC_KEY
  })

  it('checks for macOS Sparkle updates and opens the native UI', async () => {
    sparkleMocks.state.updateInfo = {
      version: '1.2.3',
      releaseName: 'Cradle 1.2.3',
      releaseNotes: 'notes',
      releaseDate: '2026-07-19T00:00:00.000Z',
      files: [{ url: 'https://updates.example.com/Cradle-mac-arm64.zip', size: 10, sha512: null }],
    }

    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle/appcast.xml',
    })

    await expect(manager.checkForUpdates()).resolves.toMatchObject({
      provider: 'sparkle',
      updateInfo: { version: '1.2.3' },
      updateDownloaded: false,
      isCheckingForUpdates: false,
    })

    const adapter = sparkleMocks.state.instances[0]
    expect(adapter.probeForUpdate).toHaveBeenCalled()
    expect(adapter.checkForUpdatesWithUI).toHaveBeenCalled()
  })

  it('installs a macOS Sparkle update after preparing quit', async () => {
    const prepareQuitForUpdate = vi.fn(async () => undefined)
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle/appcast.xml',
      prepareQuitForUpdate,
    })

    await manager.applyUpdate()

    expect(prepareQuitForUpdate).toHaveBeenCalled()
    expect(sparkleMocks.state.instances[0].installUpdateNow).toHaveBeenCalled()
  })

  it('does not open Sparkle UI during quiet background checks', async () => {
    sparkleMocks.state.updateInfo = {
      version: '1.2.3',
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      files: [],
    }
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle/appcast.xml',
    })

    await manager.checkForUpdates({ quiet: true })
    expect(sparkleMocks.state.instances[0].checkForUpdatesWithUI).not.toHaveBeenCalled()
    expect(manager.status.updateInfo?.version).toBe('1.2.3')
  })

  it('marks Sparkle as unsupported when the bridge fails to initialize', async () => {
    sparkleMocks.state.ready = false
    sparkleMocks.state.initError = 'Sparkle bridge is unavailable'
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle/appcast.xml',
    })

    // Wait for async initialize.
    await vi.waitFor(() => {
      expect(manager.status.unsupported).toBe(true)
    })
    expect(manager.status.errorMessage).toContain('Sparkle bridge is unavailable')
  })

  it('checks, downloads, and applies Windows NSIS updates through electron-updater', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    electronUpdaterMocks.autoUpdater.checkForUpdates.mockImplementation(async () => {
      electronUpdaterMocks.autoUpdater.emit('update-available', {
        version: '2.0.0',
        releaseName: 'Windows 2.0.0',
        releaseNotes: 'win notes',
        releaseDate: '2026-07-19T00:00:00.000Z',
        files: [{ url: 'Cradle-setup.exe', size: 42, sha512: 'abc' }],
      })
      return {
        isUpdateAvailable: true,
        updateInfo: {
          version: '2.0.0',
          releaseName: 'Windows 2.0.0',
          releaseNotes: 'win notes',
          releaseDate: '2026-07-19T00:00:00.000Z',
          files: [{ url: 'Cradle-setup.exe', size: 42, sha512: 'abc' }],
        },
      }
    })
    electronUpdaterMocks.autoUpdater.downloadUpdate.mockImplementation(async () => {
      electronUpdaterMocks.autoUpdater.emit('update-downloaded', {
        version: '2.0.0',
        downloadedFile: 'C:\\tmp\\Cradle-setup.exe',
        releaseName: 'Windows 2.0.0',
        releaseNotes: 'win notes',
        releaseDate: '2026-07-19T00:00:00.000Z',
        files: [{ url: 'Cradle-setup.exe', size: 42, sha512: 'abc' }],
      })
      return ['C:\\tmp\\Cradle-setup.exe']
    })

    const prepareQuitForUpdate = vi.fn(async () => undefined)
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://github.com/wibus-wee/cradle-app/releases/download/feed-dev/manifest.json',
      prepareQuitForUpdate,
    })

    await expect(manager.checkForUpdates()).resolves.toMatchObject({
      provider: 'electron-updater',
      updateInfo: { version: '2.0.0' },
    })
    await expect(manager.downloadUpdate()).resolves.toMatchObject({
      updateDownloaded: true,
    })
    await manager.applyUpdate()
    expect(prepareQuitForUpdate).toHaveBeenCalled()
    expect(electronUpdaterMocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('reports an error when apply is requested without a prepared Windows update', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/manifest.json',
    })
    await manager.applyUpdate()
    expect(manager.status.errorMessage).toBe('No prepared desktop update is available')
  })
})
