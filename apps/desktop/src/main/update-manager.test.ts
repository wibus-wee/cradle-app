import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DesktopUpdateCandidate,
  DesktopUpdateDownload,
  DesktopUpdateInstallerPlan,
} from './update-types'

const electronMocks = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => '1.2.2'),
    isPackaged: true,
  },
}))

const updateSourceMocks = vi.hoisted(() => {
  const state = {
    candidate: null as DesktopUpdateCandidate | null,
    instances: [] as Array<{ options: unknown, checkForUpdates: ReturnType<typeof vi.fn> }>,
    readUpdateFeedUrl: vi.fn(() => 'https://updates.example.com/cradle'),
  }

  class DesktopUpdateSource {
    readonly options: unknown
    readonly checkForUpdates = vi.fn(async () => state.candidate)

    constructor(options: unknown) {
      this.options = options
      state.instances.push(this)
    }
  }

  return {
    DesktopUpdateSource,
    state,
  }
})

const updateDownloaderMocks = vi.hoisted(() => {
  const state = {
    download: {
      archivePath: '/tmp/Cradle-1.2.3-universal.zip',
      artifact: {
        url: 'https://updates.example.com/cradle/macos/Cradle-1.2.3-universal.zip',
        size: 10,
        sha256: 'a'.repeat(64),
        platform: 'darwin' as const,
        arch: 'universal' as const,
      },
    } satisfies DesktopUpdateDownload,
    instances: [] as Array<{ download: ReturnType<typeof vi.fn> }>,
  }

  class DesktopUpdateDownloader {
    readonly download = vi.fn(async (_candidate: DesktopUpdateCandidate, onProgress?: (progress: { percent: number }) => void) => {
      onProgress?.({ percent: 42 })
      return state.download
    })

    constructor() {
      state.instances.push(this)
    }
  }

  return {
    DesktopUpdateDownloader,
    state,
  }
})

const updateInstallerMocks = vi.hoisted(() => {
  const state = {
    plan: {
      version: '1.2.3',
      archivePath: '/tmp/Cradle-1.2.3-universal.zip',
      stagingRoot: '/tmp/staging',
      stagedAppPath: '/tmp/staging/Cradle.app',
      targetAppPath: '/Applications/Cradle.app',
      scriptPath: '/tmp/apply-1.2.3.sh',
      resultPath: '/tmp/last-update-result.json',
      usesAdministratorPrivileges: false,
    } satisfies DesktopUpdateInstallerPlan,
    instances: [] as Array<{
      prepare: ReturnType<typeof vi.fn>
      launch: ReturnType<typeof vi.fn>
      readLastResult: ReturnType<typeof vi.fn>
    }>,
  }

  class DesktopUpdateInstaller {
    readonly prepare = vi.fn(async () => state.plan)
    readonly launch = vi.fn()
    readonly readLastResult = vi.fn(async () => null)

    constructor() {
      state.instances.push(this)
    }
  }

  return {
    DesktopUpdateInstaller,
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

  return {
    autoUpdater,
  }
})

vi.mock('electron', () => electronMocks)
vi.mock('electron-updater', () => ({
  autoUpdater: electronUpdaterMocks.autoUpdater,
}))
vi.mock('./update-source', () => ({
  DesktopUpdateSource: updateSourceMocks.DesktopUpdateSource,
  readUpdateFeedUrl: updateSourceMocks.state.readUpdateFeedUrl,
}))
vi.mock('./update-downloader', () => ({
  DesktopUpdateDownloader: updateDownloaderMocks.DesktopUpdateDownloader,
}))
vi.mock('./update-installer', () => ({
  DesktopUpdateInstaller: updateInstallerMocks.DesktopUpdateInstaller,
}))

function createCandidate(): DesktopUpdateCandidate {
  return {
    info: {
      version: '1.2.3',
      releaseName: 'Cradle 1.2.3',
      releaseNotes: null,
      releaseDate: '2026-06-20T00:00:00.000Z',
      files: [
        {
          url: 'https://updates.example.com/cradle/macos/Cradle-1.2.3-universal.zip',
          size: 10,
          sha512: null,
        },
      ],
    },
    artifact: {
      url: 'https://updates.example.com/cradle/macos/Cradle-1.2.3-universal.zip',
      size: 10,
      sha256: 'a'.repeat(64),
      platform: 'darwin',
      arch: 'universal',
    },
  }
}

function createWindowsUpdateInfo() {
  return {
    version: '1.2.3',
    releaseName: 'Cradle 1.2.3',
    releaseNotes: 'Windows release',
    releaseDate: '2026-06-20T00:00:00.000Z',
    path: 'Cradle-1.2.3-setup.exe',
    sha512: 'b'.repeat(128),
    files: [
      {
        url: 'Cradle-1.2.3-setup.exe',
        size: 100,
        sha512: 'b'.repeat(128),
      },
    ],
  }
}

describe('DesktopUpdateManager', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    })
    electronMocks.app.getVersion.mockReturnValue('1.2.2')
    updateSourceMocks.state.candidate = createCandidate()
    updateSourceMocks.state.instances.length = 0
    updateSourceMocks.state.readUpdateFeedUrl.mockReturnValue('https://updates.example.com/cradle')
    updateDownloaderMocks.state.instances.length = 0
    updateInstallerMocks.state.instances.length = 0
    electronUpdaterMocks.autoUpdater.reset()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform,
    })
  })

  it('checks, downloads, prepares, launches, and requests quit in order', async () => {
    const quitEvents: string[] = []
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle',
      requestQuitForUpdate: async () => {
        quitEvents.push('quit')
      },
    })

    await expect(manager.checkForUpdates()).resolves.toMatchObject({
      updateInfo: {
        version: '1.2.3',
      },
      updateDownloaded: false,
    })
    expect(updateDownloaderMocks.state.instances[0]?.download).not.toHaveBeenCalled()

    await expect(manager.downloadUpdate()).resolves.toMatchObject({
      downloadingProgress: 100,
      updateDownloaded: true,
      downloadedFilePath: '/tmp/Cradle-1.2.3-universal.zip',
    })
    expect(updateDownloaderMocks.state.instances[0]?.download).toHaveBeenCalledWith(
      updateSourceMocks.state.candidate,
      expect.any(Function),
    )
    expect(updateInstallerMocks.state.instances[0]?.prepare).toHaveBeenCalledWith(
      updateDownloaderMocks.state.download,
      '1.2.3',
    )

    await manager.applyUpdate()

    expect(updateInstallerMocks.state.instances[0]?.launch).toHaveBeenCalledWith(updateInstallerMocks.state.plan)
    expect(quitEvents).toEqual(['quit'])
  })

  it('reports an apply error when no prepared update is available', async () => {
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle',
      requestQuitForUpdate: vi.fn(),
    })

    await manager.applyUpdate()

    expect(manager.status.errorMessage).toBe('No prepared desktop update is available')
    expect(updateInstallerMocks.state.instances[0]?.launch).not.toHaveBeenCalled()
  })

  it('checks, downloads, and applies Windows NSIS updates through electron-updater', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32',
    })
    const updateInfo = createWindowsUpdateInfo()
    const downloadedFile = 'C:\\Users\\wibus\\AppData\\Local\\cradle-updater\\Cradle-1.2.3-setup.exe'
    electronUpdaterMocks.autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo,
      versionInfo: updateInfo,
      downloadPromise: null,
    })
    electronUpdaterMocks.autoUpdater.downloadUpdate.mockImplementation(async () => {
      electronUpdaterMocks.autoUpdater.emit('download-progress', { percent: 64 })
      electronUpdaterMocks.autoUpdater.emit('update-downloaded', {
        ...updateInfo,
        downloadedFile,
      })
      return [downloadedFile]
    })
    const quitEvents: string[] = []

    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://github.com/wibus-wee/cradle-app/releases/download/feed-dev/manifest.json',
      prepareQuitForUpdate: async () => {
        quitEvents.push('prepare')
      },
    })

    expect(manager.status.unsupported).toBe(false)
    expect(electronUpdaterMocks.autoUpdater.setFeedURL).toHaveBeenCalledWith(
      'https://github.com/wibus-wee/cradle-app/releases/download/feed-dev/',
    )
    expect(electronUpdaterMocks.autoUpdater.autoDownload).toBe(false)
    expect(electronUpdaterMocks.autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(electronUpdaterMocks.autoUpdater.allowPrerelease).toBe(true)
    expect(electronUpdaterMocks.autoUpdater.disableWebInstaller).toBe(true)
    expect(updateSourceMocks.state.instances).toHaveLength(0)
    expect(updateInstallerMocks.state.instances).toHaveLength(0)

    await expect(manager.checkForUpdates()).resolves.toMatchObject({
      updateInfo: {
        version: '1.2.3',
        releaseNotes: 'Windows release',
        files: [
          {
            url: 'Cradle-1.2.3-setup.exe',
            size: 100,
          },
        ],
      },
      updateDownloaded: false,
    })

    await expect(manager.downloadUpdate()).resolves.toMatchObject({
      downloadingProgress: 100,
      updateDownloaded: true,
      downloadedFilePath: downloadedFile,
    })

    await manager.applyUpdate()

    expect(quitEvents).toEqual(['prepare'])
    expect(electronUpdaterMocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})
