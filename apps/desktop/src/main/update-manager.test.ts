import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => '1.2.2'),
    isPackaged: true,
  },
}))

const sparkleMocks = vi.hoisted(() => {
  type SparkleEventHandler = (event: Record<string, unknown>) => void

  const state = {
    ready: true,
    initError: null as string | null,
    eventHandler: null as SparkleEventHandler | null,
    instances: [] as Array<{
      initialize: ReturnType<typeof vi.fn>
      setAutomaticChecks: ReturnType<typeof vi.fn>
      checkForUpdates: ReturnType<typeof vi.fn>
      installUpdateNow: ReturnType<typeof vi.fn>
      installUpdateOnQuit: ReturnType<typeof vi.fn>
      discardDownloadedUpdate: ReturnType<typeof vi.fn>
      setEventHandler: ReturnType<typeof vi.fn>
      isReady: boolean
      lastInitError: string | null
    }>,
  }

  class MacOSSparkleUpdateAdapter {
    initialize = vi.fn(async () => {
      if (state.ready && state.eventHandler) {
        this.bridge?.setEventHandler?.(state.eventHandler)
      }
      return { ready: state.ready, errorMessage: state.initError }
    })

    setAutomaticChecks = vi.fn()
    checkForUpdates = vi.fn()
    installUpdateNow = vi.fn()
    installUpdateOnQuit = vi.fn()
    discardDownloadedUpdate = vi.fn()
    setEventHandler = vi.fn((handler: SparkleEventHandler | null) => {
      state.eventHandler = handler
    })

    bridge = {
      setEventHandler: (handler: SparkleEventHandler | null) => {
        state.eventHandler = handler
      },
    } as { setEventHandler: (handler: SparkleEventHandler | null) => void } | null

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
    sparkleMocks.state.eventHandler = null
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

  it('checks for macOS Sparkle updates silently and maps bridge events into status', async () => {
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle/appcast.xml',
    })

    await manager.checkForUpdates()
    const adapter = sparkleMocks.state.instances[0]
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(manager.status.isCheckingForUpdates).toBe(true)

    // The silent driver reports the found update and downloads it automatically.
    sparkleMocks.state.eventHandler!({
      type: 'update-available',
      version: '2.0.0',
      releaseName: 'Cradle 2.0.0',
      releaseNotes: 'notes',
      releaseDate: '2026-07-19T00:00:00.000Z',
    })
    expect(manager.status.isCheckingForUpdates).toBe(false)
    expect(manager.status.updateInfo).toMatchObject({
      version: '2.0.0',
      releaseName: 'Cradle 2.0.0',
      files: [],
    })
    expect(manager.status.updateDownloaded).toBe(false)

    sparkleMocks.state.eventHandler!({
      type: 'download-progress',
      phase: 'download',
      percent: 42,
      transferred: 4200,
      total: 10000,
    })
    expect(manager.status.downloadProgress).toMatchObject({
      phase: 'download',
      percent: 42,
      transferred: 4200,
      total: 10000,
      fallback: false,
    })

    sparkleMocks.state.eventHandler!({
      type: 'download-progress',
      phase: 'apply',
      percent: 60,
    })
    expect(manager.status.downloadProgress).toMatchObject({ phase: 'apply', percent: 60 })
    expect(manager.status.isPreparingUpdate).toBe(true)

    sparkleMocks.state.eventHandler!({ type: 'update-downloaded', version: '2.0.0' })
    expect(manager.status.updateDownloaded).toBe(true)
    expect(manager.status.downloadProgress).toBeNull()
    expect(manager.status.isPreparingUpdate).toBe(false)
  })

  it('clears Sparkle update state when no update is available', async () => {
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle/appcast.xml',
    })

    await manager.checkForUpdates()
    sparkleMocks.state.eventHandler!({ type: 'update-not-available' })

    expect(manager.status.isCheckingForUpdates).toBe(false)
    expect(manager.status.updateInfo).toBeNull()
    expect(manager.status.updateDownloaded).toBe(false)
    expect(manager.status.downloadProgress).toBeNull()
  })

  it('surfaces Sparkle errors and keeps the failed download retryable', async () => {
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle/appcast.xml',
    })

    await manager.checkForUpdates()
    sparkleMocks.state.eventHandler!({ type: 'update-available', version: '2.0.0' })
    sparkleMocks.state.eventHandler!({ type: 'error', message: 'signature mismatch' })

    expect(manager.status.errorMessage).toBe('signature mismatch')
    expect(manager.status.isCheckingForUpdates).toBe(false)
    expect(manager.status.downloadProgress).toBeNull()
    expect(manager.status.updateInfo).toMatchObject({ version: '2.0.0' })

    // Retrying the download re-runs discovery so Sparkle re-reads the appcast.
    await manager.downloadUpdate()
    expect(sparkleMocks.state.instances[0].checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('installs a downloaded Sparkle update through installUpdateNow after the quit hook', async () => {
    const prepareQuitForUpdate = vi.fn(async () => undefined)
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle/appcast.xml',
      prepareQuitForUpdate,
    })

    await manager.checkForUpdates()
    sparkleMocks.state.eventHandler!({ type: 'update-available', version: '2.0.0' })
    sparkleMocks.state.eventHandler!({ type: 'update-downloaded', version: '2.0.0' })

    await manager.applyUpdate()

    expect(prepareQuitForUpdate).toHaveBeenCalled()
    expect(sparkleMocks.state.instances[0].installUpdateNow).toHaveBeenCalledTimes(1)
    expect(manager.status.errorMessage).toBeNull()
  })

  it('refuses to install a Sparkle update before it finished downloading', async () => {
    const prepareQuitForUpdate = vi.fn(async () => undefined)
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle/appcast.xml',
      prepareQuitForUpdate,
    })

    // Wait for async Sparkle initialization, which clears the initial error message.
    await vi.waitFor(() => {
      expect(sparkleMocks.state.instances[0].setEventHandler).toHaveBeenCalled()
    })

    await manager.applyUpdate()

    expect(prepareQuitForUpdate).not.toHaveBeenCalled()
    expect(sparkleMocks.state.instances[0].installUpdateNow).not.toHaveBeenCalled()
    expect(manager.status.errorMessage).toBe('No prepared desktop update is available')
  })

  it('stages a downloaded Sparkle update for install on quit', async () => {
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle/appcast.xml',
    })

    // Nothing downloaded yet: no staging.
    manager.installSparkleUpdateOnQuit()
    expect(sparkleMocks.state.instances[0].installUpdateOnQuit).not.toHaveBeenCalled()

    await manager.checkForUpdates()
    sparkleMocks.state.eventHandler!({ type: 'update-downloaded', version: '2.0.0' })
    manager.installSparkleUpdateOnQuit()
    expect(sparkleMocks.state.instances[0].installUpdateOnQuit).toHaveBeenCalledTimes(1)
  })

  it('releases the Sparkle event handler on shutdown', async () => {
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle/appcast.xml',
    })

    await vi.waitFor(() => {
      expect(sparkleMocks.state.instances[0].setEventHandler).toHaveBeenCalled()
    })
    await manager.shutdown()

    expect(sparkleMocks.state.instances[0].setEventHandler).toHaveBeenLastCalledWith(null)
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
      updateFeedUrl: 'https://github.com/wibus-wee/cradle-app/releases/download/feed-dev/',
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

  it('checks, downloads, and applies Linux AppImage updates through electron-updater', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const updateInfo = {
      version: '2.0.0',
      releaseName: 'Linux 2.0.0',
      releaseNotes: 'linux notes',
      releaseDate: '2026-08-09T00:00:00.000Z',
      files: [
        { url: 'Cradle-linux-x64.AppImage', size: 42, sha512: 'appimage-sha' },
        { url: 'Cradle-linux-x64.deb', size: 43, sha512: 'deb-sha' },
        { url: 'Cradle-linux-x64.rpm', size: 44, sha512: 'rpm-sha' },
      ],
    }
    electronUpdaterMocks.autoUpdater.checkForUpdates.mockImplementation(async () => {
      electronUpdaterMocks.autoUpdater.emit('update-available', updateInfo)
      return { isUpdateAvailable: true, updateInfo }
    })
    electronUpdaterMocks.autoUpdater.downloadUpdate.mockImplementation(async () => {
      electronUpdaterMocks.autoUpdater.emit('update-downloaded', {
        ...updateInfo,
        downloadedFile: '/tmp/Cradle-linux-x64.AppImage',
      })
      return ['/tmp/Cradle-linux-x64.AppImage']
    })

    const prepareQuitForUpdate = vi.fn(async () => undefined)
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://github.com/wibus-wee/cradle-app/releases/download/feed-dev/',
      prepareQuitForUpdate,
    })

    await expect(manager.checkForUpdates()).resolves.toMatchObject({
      unsupported: false,
      provider: 'electron-updater',
      updateInfo: {
        version: '2.0.0',
        files: [{ url: 'Cradle-linux-x64.AppImage', size: 42 }],
      },
    })
    expect(electronUpdaterMocks.autoUpdater.disableWebInstaller).toBe(false)
    expect(electronUpdaterMocks.autoUpdater.setFeedURL).toHaveBeenCalledWith(
      'https://github.com/wibus-wee/cradle-app/releases/download/feed-dev/',
    )

    await expect(manager.downloadUpdate()).resolves.toMatchObject({ updateDownloaded: true })
    await manager.applyUpdate()
    expect(prepareQuitForUpdate).toHaveBeenCalled()
    expect(electronUpdaterMocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('reports an error when apply is requested without a prepared Windows update', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/',
    })
    await manager.applyUpdate()
    expect(manager.status.errorMessage).toBe('No prepared desktop update is available')
  })
})
