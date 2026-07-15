import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DesktopUpdateCandidate,
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
      discard: ReturnType<typeof vi.fn>
      discardStaleStaging: ReturnType<typeof vi.fn>
    }>,
  }

  class DesktopUpdateInstaller {
    readonly prepare = vi.fn(async () => state.plan)
    readonly launch = vi.fn()
    readonly readLastResult = vi.fn(async () => null)
    readonly discard = vi.fn(async () => undefined)
    readonly discardStaleStaging = vi.fn(async () => undefined)

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
  CancellationToken: class {
    cancelled = false
    cancel(): void { this.cancelled = true }
  },
}))
vi.mock('./update-source', () => ({
  DesktopUpdateSource: updateSourceMocks.DesktopUpdateSource,
  readUpdateFeedUrl: updateSourceMocks.state.readUpdateFeedUrl,
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

describe('desktopUpdateManager', () => {
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
      downloadCenter: {
        execute: vi.fn(async () => ({
          taskId: 'mac-update-task',
          filePath: '/tmp/Cradle-1.2.3-universal.zip',
          bytes: 10,
          checksum: { algorithm: 'sha256' as const, expected: 'a'.repeat(64), actual: 'a'.repeat(64), matched: true },
        })),
        release: vi.fn(async () => ({}) as never),
      },
    })

    await expect(manager.checkForUpdates()).resolves.toMatchObject({
      updateInfo: {
        version: '1.2.3',
      },
      updateDownloaded: false,
    })
    await expect(manager.downloadUpdate()).resolves.toMatchObject({
      updateDownloaded: true,
    })
    expect(updateInstallerMocks.state.instances[0]?.prepare).toHaveBeenCalledWith(expect.objectContaining({
      archivePath: '/tmp/Cradle-1.2.3-universal.zip',
      artifact: updateSourceMocks.state.candidate?.artifact,
      taskId: 'mac-update-task',
    }), '1.2.3')

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

  it('requires the Download Center before preparing a macOS update', async () => {
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({ updateFeedUrl: 'https://updates.example.com/cradle' })

    await manager.checkForUpdates()
    await expect(manager.downloadUpdate()).resolves.toMatchObject({
      updateDownloaded: false,
      errorMessage: 'Desktop Download Center is not ready',
    })
  })

  it('releases an unapplicable prepared macOS artifact and clears its staging on shutdown', async () => {
    const release = vi.fn(async () => undefined)
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle',
      downloadCenter: {
        execute: vi.fn(async () => ({
          taskId: 'mac-update-task',
          filePath: '/tmp/Cradle-1.2.3-universal.zip',
          bytes: 10,
          checksum: { algorithm: 'sha256' as const, expected: 'a'.repeat(64), actual: 'a'.repeat(64), matched: true },
        })),
        release,
      } as never,
    })
    await manager.checkForUpdates()
    await manager.downloadUpdate()
    await manager.shutdown()

    expect(release).toHaveBeenCalledWith('mac-update-task')
    expect(updateInstallerMocks.state.instances[0]?.discard).toHaveBeenCalledWith(updateInstallerMocks.state.plan)
  })

  it('discards the previous prepared update before accepting a newly checked candidate', async () => {
    const release = vi.fn(async () => undefined)
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle',
      downloadCenter: {
        execute: vi.fn(async () => ({
          taskId: 'superseded-update-task',
filePath: '/tmp/Cradle.zip',
bytes: 10,
          checksum: { algorithm: 'sha256' as const, expected: 'a'.repeat(64), actual: 'a'.repeat(64), matched: true },
        })),
        release,
      } as never,
    })
    await manager.checkForUpdates()
    await manager.downloadUpdate()
    await manager.checkForUpdates()

    expect(release).toHaveBeenCalledWith('superseded-update-task')
    expect(updateInstallerMocks.state.instances[0]?.discard).toHaveBeenCalledWith(updateInstallerMocks.state.plan)
  })

  it('releases stale macOS update artifacts at the next desktop boot', async () => {
    const release = vi.fn(async () => undefined)
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({ updateFeedUrl: 'https://updates.example.com/cradle' })
    await manager.recoverDownloadCenter({
      execute: vi.fn(),
      release,
      beginExternal: vi.fn(),
      reportExternal: vi.fn(),
      list: () => [{
        taskId: 'stale-task',
scope: 'desktop',
owner: { namespace: 'desktop-update', resourceType: 'macos-update', resourceId: '1.2.3', displayName: 'Cradle 1.2.3' },
fileName: 'Cradle.zip',
sourceId: 'desktop-update',
status: 'completed',
transferredBytes: 10,
totalBytes: 10,
attempts: 1,
maxAttempts: 1,
error: null,
result: null,
createdAt: '2026-07-15T00:00:00.000Z',
updatedAt: '2026-07-15T00:00:00.000Z',
startedAt: '2026-07-15T00:00:00.000Z',
finishedAt: '2026-07-15T00:00:00.000Z',
      }],
    } as never)
    expect(release).toHaveBeenCalledWith('stale-task')
    expect(updateInstallerMocks.state.instances[0]?.discardStaleStaging).toHaveBeenCalledOnce()
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
      updateDownloaded: true,
    })

    await manager.applyUpdate()

    expect(quitEvents).toEqual(['prepare'])
    expect(electronUpdaterMocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('projects a Windows updater download and propagates Download Center cancellation', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const updateInfo = createWindowsUpdateInfo()
    electronUpdaterMocks.autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo,
      versionInfo: updateInfo,
      downloadPromise: null,
    })
    let cancelProjection: (() => void) | undefined
    const reportExternal = vi.fn(async () => null)
    electronUpdaterMocks.autoUpdater.downloadUpdate.mockImplementation((token: { cancelled: boolean }) => new Promise<string[]>((_, reject) => {
      const interval = setInterval(() => {
        if (!token.cancelled) { return }
        clearInterval(interval)
        reject(new Error('cancelled'))
      }, 1)
    }))

    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({ updateFeedUrl: 'https://updates.example.com/manifest.json' })
    manager.setDownloadCenter({
      execute: vi.fn(),
      release: vi.fn(),
      beginExternal: vi.fn(async (_request, cancel) => {
        cancelProjection = cancel
        return { taskId: 'windows-update-task' }
      }),
      reportExternal,
    } as never)

    await manager.checkForUpdates()
    const download = manager.downloadUpdate()
    await vi.waitFor(() => expect(cancelProjection).toBeTypeOf('function'))
    cancelProjection?.()
    await download

    expect(reportExternal).toHaveBeenCalledWith('windows-update-task', expect.objectContaining({
      status: 'cancelled',
      error: expect.objectContaining({ code: 'cancelled' }),
    }))
    expect(electronUpdaterMocks.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
  })
})
