import type {
  AppUpdater,
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater'
import { autoUpdater } from 'electron-updater'

import type {
  DesktopUpdateFile,
  DesktopUpdateInfo,
  DesktopUpdateStatus,
} from './update-types'

export type WindowsDesktopUpdateAdapterOptions = {
  updateFeedUrl: string
  updater?: AppUpdater
  onStatusChanged: (patch: Partial<DesktopUpdateStatus>) => void
}

export class WindowsDesktopUpdateAdapter {
  private readonly updater: AppUpdater
  private readonly onStatusChanged: (patch: Partial<DesktopUpdateStatus>) => void
  private downloadedFilePath: string | null = null

  constructor(options: WindowsDesktopUpdateAdapterOptions) {
    this.updater = options.updater ?? autoUpdater
    this.onStatusChanged = options.onStatusChanged

    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
    this.updater.allowPrerelease = true
    this.updater.disableWebInstaller = true
    this.updater.logger = console
    this.updater.setFeedURL(resolveWindowsUpdaterFeedUrl(options.updateFeedUrl))

    this.updater.on('checking-for-update', () => {
      this.onStatusChanged({
        isCheckingForUpdates: true,
        errorMessage: null,
      })
    })
    this.updater.on('update-available', (info) => {
      this.downloadedFilePath = null
      this.onStatusChanged({
        isCheckingForUpdates: false,
        updateInfo: projectUpdateInfo(info),
        updateDownloaded: false,
        downloadedFilePath: null,
        downloadingProgress: 0,
      })
    })
    this.updater.on('update-not-available', () => {
      this.downloadedFilePath = null
      this.onStatusChanged({
        isCheckingForUpdates: false,
        updateInfo: null,
        updateDownloaded: false,
        downloadedFilePath: null,
        downloadingProgress: 0,
      })
    })
    this.updater.on('download-progress', (progress) => {
      this.onStatusChanged({
        isDownloadingUpdate: true,
        downloadingProgress: readProgressPercent(progress),
      })
    })
    this.updater.on('update-downloaded', (event) => {
      this.downloadedFilePath = event.downloadedFile
      this.onStatusChanged({
        isDownloadingUpdate: false,
        downloadingProgress: 100,
        updateDownloaded: true,
        downloadedFilePath: event.downloadedFile,
      })
    })
    this.updater.on('error', (error) => {
      this.onStatusChanged({
        isCheckingForUpdates: false,
        isDownloadingUpdate: false,
        errorMessage: error.message,
      })
    })
  }

  async checkForUpdates(): Promise<DesktopUpdateInfo | null> {
    const result = await this.updater.checkForUpdates()
    if (!result?.isUpdateAvailable) {
      return null
    }
    return projectUpdateInfo(result.updateInfo)
  }

  async downloadUpdate(): Promise<string | null> {
    const paths = await this.updater.downloadUpdate()
    return paths[0] ?? this.downloadedFilePath
  }

  applyUpdate(): void {
    this.updater.quitAndInstall(false, true)
  }
}

export function resolveWindowsUpdaterFeedUrl(updateFeedUrl: string): string {
  const url = updateFeedUrl.trim()
  if (url.endsWith('/manifest.json')) {
    return url.slice(0, -'manifest.json'.length)
  }
  if (url.endsWith('.json')) {
    return url.slice(0, url.lastIndexOf('/') + 1)
  }
  return url.endsWith('/') ? url : `${url}/`
}

function projectUpdateInfo(info: UpdateInfo): DesktopUpdateInfo {
  return {
    version: info.version,
    releaseName: info.releaseName ?? null,
    releaseNotes: projectReleaseNotes(info.releaseNotes),
    releaseDate: info.releaseDate,
    files: info.files.map(projectUpdateFile),
  }
}

function projectUpdateFile(file: UpdateInfo['files'][number]): DesktopUpdateFile {
  return {
    url: file.url,
    size: file.size ?? null,
    sha512: file.sha512,
  }
}

function projectReleaseNotes(releaseNotes: UpdateDownloadedEvent['releaseNotes']): string | null {
  if (typeof releaseNotes === 'string') {
    return releaseNotes
  }
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map(note => note.note)
      .filter(note => Boolean(note))
      .join('\n\n') || null
  }
  return null
}

function readProgressPercent(progress: ProgressInfo): number {
  return Math.max(0, Math.min(100, progress.percent))
}
