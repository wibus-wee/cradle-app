import { EventEmitter } from 'node:events'

import { app } from 'electron'

import type { DesktopDownloadCenterService } from './download-center'
import { MacOSSparkleUpdateAdapter } from './macos-sparkle-update-adapter'
import {
  readSparkleAppcastUrl,
  readUpdateFeedUrl,
  resolveElectronUpdaterFeedUrl,
} from './update-feed'
import type {
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
  downloadCenter?: Pick<DesktopDownloadCenterService, 'execute' | 'release'>
  sparkleAdapter?: MacOSSparkleUpdateAdapter
  windowsUpdater?: WindowsDesktopUpdateAdapter
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
  private readonly sparkleAdapter: MacOSSparkleUpdateAdapter | null
  private readonly windowsUpdater: WindowsDesktopUpdateAdapter | null
  private preferences: DesktopUpdatePreferences
  private statusSnapshot: DesktopUpdateStatus
  private backgroundTimer: NodeJS.Timeout | null = null
  private backgroundCheckRunning = false
  private downloadInProgress = false
  private sparkleReadyPromise: Promise<void> | null = null
  private downloadCenter: Pick<DesktopDownloadCenterService, 'execute' | 'release'> | null

  constructor(options: DesktopUpdateManagerOptions = {}) {
    const currentVersion = app.getVersion()
    const updateFeedUrl = options.updateFeedUrl ?? readUpdateFeedUrl()
    const unsupportedReason = readUnsupportedReason(updateFeedUrl)
    const updatePlatform = unsupportedReason ? null : readUpdatePlatform()

    this.prepareQuitForUpdate = options.prepareQuitForUpdate ?? null
    this.downloadCenter = options.downloadCenter ?? null
    this.sparkleAdapter = updatePlatform === 'darwin'
      ? (options.sparkleAdapter ?? new MacOSSparkleUpdateAdapter({
          updateFeedUrl,
        }))
      : null
    this.windowsUpdater = updatePlatform === 'win32'
      ? (options.windowsUpdater ?? new WindowsDesktopUpdateAdapter({
          updateFeedUrl: updateFeedUrl!,
          onStatusChanged: patch => this.setStatus(patch),
        }))
      : null
    this.preferences = {
      autoCheckForUpdates: options.preferences?.autoCheckForUpdates ?? true,
      autoDownloadUpdates: options.preferences?.autoDownloadUpdates ?? false,
    }
    this.statusSnapshot = {
      unsupported: unsupportedReason !== null,
      provider: unsupportedReason
        ? null
        : updatePlatform === 'darwin'
          ? 'sparkle'
          : updatePlatform === 'win32'
            ? 'electron-updater'
            : null,
      currentVersion,
      isCheckingForUpdates: false,
      isPreparingUpdate: false,
      updateDownloaded: false,
      updateInfo: null,
      errorMessage: unsupportedReason,
    }

    if (this.sparkleAdapter && !unsupportedReason) {
      this.sparkleReadyPromise = this.initializeSparkle()
    }
  }

  get status(): DesktopUpdateStatus {
    return this.statusSnapshot
  }

  setDownloadCenter(downloadCenter: Pick<DesktopDownloadCenterService, 'execute' | 'release' | 'beginExternal' | 'reportExternal'>): void {
    this.downloadCenter = downloadCenter
    this.windowsUpdater?.setDownloadCenter(downloadCenter)
  }

  /**
   * Sparkle owns macOS update staging. Legacy Cradle macos-update Download Center
   * tasks are released so Settings does not show a stale prepared update.
   */
  async recoverDownloadCenter(downloadCenter: Pick<DesktopDownloadCenterService, 'execute' | 'release' | 'beginExternal' | 'reportExternal' | 'list'>): Promise<void> {
    this.setDownloadCenter(downloadCenter)
    const staleTasks = downloadCenter.list().filter(task =>
      task.status === 'completed'
      && task.owner.namespace === 'desktop-update'
      && task.owner.resourceType === 'macos-update')
    await Promise.all(staleTasks.map(task => downloadCenter.release(task.taskId)))
  }

  async shutdown(): Promise<void> {
    this.stopBackgroundChecks()
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
      (!this.sparkleAdapter && !this.windowsUpdater)
      || this.backgroundTimer
      || this.backgroundCheckRunning
      || !this.preferences.autoCheckForUpdates
      || this.statusSnapshot.unsupported
    ) {
      return
    }

    // macOS: Sparkle owns scheduled checks via setAutomaticChecks.
    if (this.sparkleAdapter) {
      void this.ensureSparkleReady().then(() => {
        this.sparkleAdapter?.setAutomaticChecks(this.preferences.autoCheckForUpdates)
      })
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
    if (this.sparkleAdapter) {
      this.sparkleAdapter.setAutomaticChecks(false)
    }
    if (!this.backgroundTimer) {
      return
    }
    clearTimeout(this.backgroundTimer)
    this.backgroundTimer = null
  }

  configurePreferences(preferences: DesktopUpdatePreferences): DesktopUpdateStatus {
    this.preferences = preferences

    if (this.sparkleAdapter) {
      void this.ensureSparkleReady().then(() => {
        this.sparkleAdapter?.setAutomaticChecks(preferences.autoCheckForUpdates)
      })
      return this.statusSnapshot
    }

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

    if (this.sparkleAdapter) {
      return await this.checkForSparkleUpdates(options)
    }

    return this.statusSnapshot
  }

  async downloadUpdate(): Promise<DesktopUpdateStatus> {
    if (this.windowsUpdater) {
      return await this.downloadWindowsUpdate()
    }

    if (this.sparkleAdapter) {
      this.setStatus({ errorMessage: 'Sparkle manages download and installation in its native update window' })
      return this.statusSnapshot
    }

    return this.statusSnapshot
  }

  async applyUpdate(): Promise<void> {
    if (this.windowsUpdater) {
      await this.applyWindowsUpdate()
      return
    }

    this.setStatus({
      errorMessage: this.sparkleAdapter
        ? 'Sparkle manages installation in its native update window'
        : 'No prepared desktop update is available',
    })
  }

  private async initializeSparkle(): Promise<void> {
    const result = await this.sparkleAdapter!.initialize()
    if (!result.ready) {
      this.setStatus({
        unsupported: true,
        errorMessage: result.errorMessage,
      })
      return
    }

    this.sparkleAdapter!.setAutomaticChecks(this.preferences.autoCheckForUpdates)
    this.setStatus({
      unsupported: false,
      errorMessage: null,
    })
  }

  private async ensureSparkleReady(): Promise<void> {
    if (this.sparkleReadyPromise) {
      await this.sparkleReadyPromise
    }
  }

  private async checkForSparkleUpdates(options: CheckForUpdatesOptions): Promise<DesktopUpdateStatus> {
    if (this.statusSnapshot.isCheckingForUpdates || this.downloadInProgress || this.statusSnapshot.isPreparingUpdate) {
      return this.statusSnapshot
    }

    this.setStatus({
      isCheckingForUpdates: true,
      errorMessage: null,
    })

    try {
      await this.ensureSparkleReady()
      if (!this.sparkleAdapter!.isReady) {
        throw new Error(this.sparkleAdapter!.lastInitError ?? 'Sparkle bridge is not ready')
      }

      // Manual checks open Sparkle's canonical UI. Scheduled checks are owned by
      // Sparkle through setAutomaticChecks and never mirrored into Cradle state.
      if (!options.quiet) {
        this.sparkleAdapter!.checkForUpdatesWithUI()
      }

      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: null,
        updateDownloaded: false,
      })
    }
    catch (error) {
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: null,
        updateDownloaded: false,
        errorMessage: options.quiet ? this.statusSnapshot.errorMessage : readErrorMessage(error),
      })
    }

    return this.statusSnapshot
  }

  private setStatus(patch: Partial<DesktopUpdateStatus>): void {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...patch,
    }
    this.events.emit('statusChanged', this.statusSnapshot)
  }

  private async checkForWindowsUpdates(options: CheckForUpdatesOptions): Promise<DesktopUpdateStatus> {
    if (this.statusSnapshot.isCheckingForUpdates || this.downloadInProgress || this.statusSnapshot.isPreparingUpdate) {
      return this.statusSnapshot
    }

    this.setStatus({
      isCheckingForUpdates: true,
      errorMessage: null,
    })

    try {
      const updateInfo = await retryWithBackoff(() => this.windowsUpdater!.checkForUpdates())
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo,
        updateDownloaded: false,
      })
    }
    catch (error) {
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: null,
        updateDownloaded: false,
        errorMessage: options.quiet ? this.statusSnapshot.errorMessage : readErrorMessage(error),
      })
    }

    return this.statusSnapshot
  }

  private async downloadWindowsUpdate(): Promise<DesktopUpdateStatus> {
    if (this.downloadInProgress || !this.statusSnapshot.updateInfo) {
      return this.statusSnapshot
    }

    this.downloadInProgress = true
    this.setStatus({ isPreparingUpdate: false, updateDownloaded: false, errorMessage: null })

    try {
      await this.windowsUpdater!.downloadUpdate()
      this.setStatus({
        isPreparingUpdate: false,
        updateDownloaded: true,
      })
    }
    catch (error) {
      this.setStatus({
        isPreparingUpdate: false,
        updateDownloaded: false,
        errorMessage: readErrorMessage(error),
      })
    }
    finally {
      this.downloadInProgress = false
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
  if (process.platform === 'darwin') {
    if (!readSparkleAppcastUrl(updateFeedUrl)) {
      return 'CRADLE_DESKTOP_SPARKLE_APPCAST_URL / CRADLE_DESKTOP_UPDATE_URL is not configured'
    }
  }
  else if (!updateFeedUrl) {
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

export { readUpdateFeedUrl, resolveElectronUpdaterFeedUrl }
