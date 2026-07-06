import { EventEmitter } from 'node:events'

import { app } from 'electron'

import { DesktopUpdateDownloader } from './update-downloader'
import { DesktopUpdateInstaller } from './update-installer'
import { DesktopUpdateSource, readUpdateFeedUrl } from './update-source'
import type {
  DesktopUpdateCandidate,
  DesktopUpdateInstallerPlan,
  DesktopUpdatePreferences,
  DesktopUpdateStatus,
} from './update-types'
import { readErrorMessage } from './update-types'
import { WindowsDesktopUpdateAdapter } from './windows-update-adapter'

export type {
  DesktopUpdateFile,
  DesktopUpdateInfo,
  DesktopUpdatePreferences,
  DesktopUpdateStatus,
} from './update-types'

const BACKGROUND_CHECK_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_RETRY_COUNT = 3
const DEFAULT_RETRY_DELAY_MS = 1000

export type DesktopUpdateManagerEvents = {
  statusChanged: [status: DesktopUpdateStatus]
}

type DesktopUpdateEventName = keyof DesktopUpdateManagerEvents

export type DesktopUpdateManagerOptions = {
  updateFeedUrl?: string | null
  preferences?: Partial<DesktopUpdatePreferences>
  prepareQuitForUpdate?: () => void | Promise<void>
  requestQuitForUpdate?: () => void | Promise<void>
}

type CheckForUpdatesOptions = {
  quiet?: boolean
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  retryCount = DEFAULT_RETRY_COUNT,
  delayMs = DEFAULT_RETRY_DELAY_MS,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      return await operation()
    }
    catch (error) {
      lastError = error
      if (attempt === retryCount) {
        break
      }
      await new Promise(resolve => setTimeout(resolve, delayMs * 2 ** attempt))
    }
  }

  throw lastError
}

export class DesktopUpdateManager {
  private readonly events = new EventEmitter()
  private readonly prepareQuitForUpdate: (() => void | Promise<void>) | null
  private readonly requestQuitForUpdate: (() => void | Promise<void>) | null
  private readonly source: DesktopUpdateSource | null
  private readonly downloader: DesktopUpdateDownloader | null
  private readonly installer: DesktopUpdateInstaller | null
  private readonly windowsUpdater: WindowsDesktopUpdateAdapter | null
  private preferences: DesktopUpdatePreferences
  private statusSnapshot: DesktopUpdateStatus
  private backgroundTimer: NodeJS.Timeout | null = null
  private backgroundCheckRunning = false
  private availableUpdate: DesktopUpdateCandidate | null = null
  private installerPlan: DesktopUpdateInstallerPlan | null = null

  constructor(options: DesktopUpdateManagerOptions = {}) {
    const currentVersion = app.getVersion()
    const updateFeedUrl = options.updateFeedUrl ?? readUpdateFeedUrl()
    const unsupportedReason = readUnsupportedReason(updateFeedUrl)
    const updatePlatform = unsupportedReason ? null : readUpdatePlatform()

    this.prepareQuitForUpdate = options.prepareQuitForUpdate ?? null
    this.requestQuitForUpdate = options.requestQuitForUpdate ?? null
    this.source = updatePlatform === 'darwin'
      ? new DesktopUpdateSource({
          updateFeedUrl,
          currentVersion,
        })
      : null
    this.downloader = updatePlatform === 'darwin' ? new DesktopUpdateDownloader() : null
    this.installer = updatePlatform === 'darwin' ? new DesktopUpdateInstaller() : null
    this.windowsUpdater = updatePlatform === 'win32'
      ? new WindowsDesktopUpdateAdapter({
          updateFeedUrl: updateFeedUrl!,
          onStatusChanged: patch => this.setStatus(patch),
        })
      : null
    this.preferences = {
      autoCheckForUpdates: options.preferences?.autoCheckForUpdates ?? true,
      autoDownloadUpdates: options.preferences?.autoDownloadUpdates ?? false,
    }
    this.statusSnapshot = {
      unsupported: unsupportedReason !== null,
      currentVersion,
      isCheckingForUpdates: false,
      isDownloadingUpdate: false,
      isPreparingUpdate: false,
      downloadingProgress: 0,
      updateDownloaded: false,
      downloadedFilePath: null,
      updateInfo: null,
      errorMessage: unsupportedReason,
    }

    if (this.installer) {
      void this.loadLastApplyResult()
    }
  }

  get status(): DesktopUpdateStatus {
    return this.statusSnapshot
  }

  on<K extends DesktopUpdateEventName>(
    event: K,
    listener: (...args: DesktopUpdateManagerEvents[K]) => void,
  ): this {
    this.events.on(event, listener)
    return this
  }

  off<K extends DesktopUpdateEventName>(
    event: K,
    listener: (...args: DesktopUpdateManagerEvents[K]) => void,
  ): this {
    this.events.off(event, listener)
    return this
  }

  startBackgroundChecks(): void {
    if (
      (!this.source && !this.windowsUpdater)
      || this.backgroundTimer
      || this.backgroundCheckRunning
      || !this.preferences.autoCheckForUpdates
    ) {
      return
    }

    const check = async () => {
      this.backgroundCheckRunning = true
      try {
        await this.checkForUpdates({ quiet: true })
        if (this.preferences.autoDownloadUpdates && this.statusSnapshot.updateInfo) {
          await this.downloadUpdate()
        }
      }
      finally {
        this.backgroundCheckRunning = false
        this.backgroundTimer = this.preferences.autoCheckForUpdates
          ? setTimeout(check, BACKGROUND_CHECK_INTERVAL_MS)
          : null
      }
    }

    void check()
  }

  stopBackgroundChecks(): void {
    if (!this.backgroundTimer) {
      return
    }
    clearTimeout(this.backgroundTimer)
    this.backgroundTimer = null
  }

  configurePreferences(preferences: DesktopUpdatePreferences): DesktopUpdateStatus {
    this.preferences = preferences

    if (!preferences.autoCheckForUpdates) {
      this.stopBackgroundChecks()
      return this.statusSnapshot
    }

    this.startBackgroundChecks()
    return this.statusSnapshot
  }

  async checkForUpdates(options: CheckForUpdatesOptions = {}): Promise<DesktopUpdateStatus> {
    if (this.windowsUpdater) {
      return await this.checkForWindowsUpdates(options)
    }

    if (!this.source || this.statusSnapshot.isCheckingForUpdates || this.statusSnapshot.isDownloadingUpdate || this.statusSnapshot.isPreparingUpdate) {
      return this.statusSnapshot
    }

    this.setStatus({
      isCheckingForUpdates: true,
      errorMessage: null,
    })

    try {
      const candidate = await retryWithBackoff(() => this.source!.checkForUpdates())
      this.availableUpdate = candidate
      this.installerPlan = null
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: candidate?.info ?? null,
        updateDownloaded: false,
        downloadedFilePath: null,
        downloadingProgress: 0,
      })
    }
    catch (error) {
      this.availableUpdate = null
      this.installerPlan = null
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: null,
        updateDownloaded: false,
        downloadedFilePath: null,
        downloadingProgress: 0,
        errorMessage: options.quiet ? this.statusSnapshot.errorMessage : readErrorMessage(error),
      })
    }

    return this.statusSnapshot
  }

  async downloadUpdate(): Promise<DesktopUpdateStatus> {
    if (this.windowsUpdater) {
      return await this.downloadWindowsUpdate()
    }

    if (
      !this.downloader
      || !this.installer
      || this.statusSnapshot.isDownloadingUpdate
      || !this.availableUpdate
    ) {
      return this.statusSnapshot
    }
    const downloader = this.downloader
    const installer = this.installer
    const availableUpdate = this.availableUpdate

    this.setStatus({
      isDownloadingUpdate: true,
      isPreparingUpdate: false,
      updateDownloaded: false,
      downloadedFilePath: null,
      downloadingProgress: 0,
      errorMessage: null,
    })

    try {
      const download = await retryWithBackoff(() => downloader.download(availableUpdate, (progress) => {
        this.setStatus({
          isDownloadingUpdate: true,
          isPreparingUpdate: false,
          downloadingProgress: progress.percent,
        })
      }))
      this.setStatus({
        isDownloadingUpdate: false,
        isPreparingUpdate: true,
        downloadingProgress: 100,
      })
      const plan = await installer.prepare(download, availableUpdate.info.version)
      this.installerPlan = plan
      this.setStatus({
        isDownloadingUpdate: false,
        isPreparingUpdate: false,
        downloadingProgress: 100,
        updateDownloaded: true,
        downloadedFilePath: plan.archivePath,
      })
    }
    catch (error) {
      this.installerPlan = null
      this.setStatus({
        isDownloadingUpdate: false,
        isPreparingUpdate: false,
        updateDownloaded: false,
        downloadedFilePath: null,
        errorMessage: readErrorMessage(error),
      })
    }

    return this.statusSnapshot
  }

  async applyUpdate(): Promise<void> {
    if (this.windowsUpdater) {
      await this.applyWindowsUpdate()
      return
    }

    if (!this.installerPlan) {
      this.setStatus({
        errorMessage: 'No prepared desktop update is available',
      })
      return
    }
    if (!this.requestQuitForUpdate) {
      this.setStatus({
        errorMessage: 'Desktop update quit hook is not configured',
      })
      return
    }

    try {
      this.installer!.launch(this.installerPlan)
      await this.requestQuitForUpdate()
    }
    catch (error) {
      this.setStatus({
        errorMessage: readErrorMessage(error),
      })
    }
  }

  private async loadLastApplyResult(): Promise<void> {
    const result = await this.installer!.readLastResult()
    if (!result || result.ok) {
      return
    }

    this.setStatus({
      errorMessage: result.error ?? `Desktop update ${result.version} failed`,
    })
  }

  private setStatus(patch: Partial<DesktopUpdateStatus>): void {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...patch,
    }
    this.events.emit('statusChanged', this.statusSnapshot)
  }

  private async checkForWindowsUpdates(options: CheckForUpdatesOptions): Promise<DesktopUpdateStatus> {
    if (this.statusSnapshot.isCheckingForUpdates || this.statusSnapshot.isDownloadingUpdate || this.statusSnapshot.isPreparingUpdate) {
      return this.statusSnapshot
    }

    this.setStatus({
      isCheckingForUpdates: true,
      errorMessage: null,
    })

    try {
      const updateInfo = await retryWithBackoff(() => this.windowsUpdater!.checkForUpdates())
      this.availableUpdate = null
      this.installerPlan = null
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo,
        updateDownloaded: false,
        downloadedFilePath: null,
        downloadingProgress: 0,
      })
    }
    catch (error) {
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: null,
        updateDownloaded: false,
        downloadedFilePath: null,
        downloadingProgress: 0,
        errorMessage: options.quiet ? this.statusSnapshot.errorMessage : readErrorMessage(error),
      })
    }

    return this.statusSnapshot
  }

  private async downloadWindowsUpdate(): Promise<DesktopUpdateStatus> {
    if (this.statusSnapshot.isDownloadingUpdate || !this.statusSnapshot.updateInfo) {
      return this.statusSnapshot
    }

    this.setStatus({
      isDownloadingUpdate: true,
      isPreparingUpdate: false,
      updateDownloaded: false,
      downloadedFilePath: null,
      downloadingProgress: 0,
      errorMessage: null,
    })

    try {
      const downloadedFilePath = await retryWithBackoff(() => this.windowsUpdater!.downloadUpdate())
      this.setStatus({
        isDownloadingUpdate: false,
        isPreparingUpdate: false,
        downloadingProgress: 100,
        updateDownloaded: true,
        downloadedFilePath,
      })
    }
    catch (error) {
      this.setStatus({
        isDownloadingUpdate: false,
        isPreparingUpdate: false,
        updateDownloaded: false,
        downloadedFilePath: null,
        errorMessage: readErrorMessage(error),
      })
    }

    return this.statusSnapshot
  }

  private async applyWindowsUpdate(): Promise<void> {
    if (!this.statusSnapshot.updateDownloaded) {
      this.setStatus({
        errorMessage: 'No prepared desktop update is available',
      })
      return
    }
    if (!this.prepareQuitForUpdate) {
      this.setStatus({
        errorMessage: 'Desktop update quit hook is not configured',
      })
      return
    }

    try {
      await this.prepareQuitForUpdate()
      this.windowsUpdater!.applyUpdate()
    }
    catch (error) {
      this.setStatus({
        errorMessage: readErrorMessage(error),
      })
    }
  }
}

function readUnsupportedReason(updateFeedUrl: string | null): string | null {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return 'Desktop self-updates are only available on macOS and Windows'
  }
  if (!updateFeedUrl) {
    return 'CRADLE_DESKTOP_UPDATE_URL is not configured'
  }
  if (!app.isPackaged && process.env.CRADLE_DESKTOP_ALLOW_DEV_UPDATES !== 'true') {
    return 'Desktop updates are only available in packaged builds'
  }
  return null
}

function readUpdatePlatform(): 'darwin' | 'win32' | null {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return process.platform
  }
  return null
}
