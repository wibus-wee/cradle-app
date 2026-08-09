import { readFileSync } from 'node:fs'
import path from 'node:path'

import type {
  AppUpdater,
  CancellationToken,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater'
import { autoUpdater, CancellationToken as ElectronUpdaterCancellationToken } from 'electron-updater'

import type { DesktopDownloadCenterService } from './download-center'
import { resolveElectronUpdaterFeedUrl } from './update-feed'
import type {
  DesktopUpdateFile,
  DesktopUpdateInfo,
  DesktopUpdateStatus,
} from './update-types'

export type ElectronUpdaterPlatform = 'linux' | 'win32'
export type ElectronUpdaterArtifactType = 'AppImage' | 'deb' | 'exe' | 'rpm'

export type ElectronDesktopUpdateAdapterOptions = {
  platform: ElectronUpdaterPlatform
  artifactType?: ElectronUpdaterArtifactType
  updateFeedUrl: string
  updater?: AppUpdater
  onStatusChanged: (patch: Partial<DesktopUpdateStatus>) => void
  downloadCenter?: Pick<DesktopDownloadCenterService, 'beginExternal' | 'reportExternal'>
}

export class ElectronDesktopUpdateAdapter {
  private readonly updater: AppUpdater
  private readonly onStatusChanged: (patch: Partial<DesktopUpdateStatus>) => void
  private downloadedFilePath: string | null = null
  private cancellationToken: CancellationToken | null = null
  private readonly updateFeedUrl: string
  private readonly platform: ElectronUpdaterPlatform
  private readonly artifactType: ElectronUpdaterArtifactType
  private downloadCenter: Pick<DesktopDownloadCenterService, 'beginExternal' | 'reportExternal'> | null
  private projectedTaskId: string | null = null
  private latestUpdateInfo: UpdateInfo | null = null

  constructor(options: ElectronDesktopUpdateAdapterOptions) {
    this.updater = options.updater ?? autoUpdater
    this.onStatusChanged = options.onStatusChanged
    this.updateFeedUrl = options.updateFeedUrl
    this.platform = options.platform
    this.artifactType = options.artifactType ?? readArtifactType(options.platform)
    this.downloadCenter = options.downloadCenter ?? null

    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
    this.updater.allowPrerelease = true
    this.updater.disableWebInstaller = options.platform === 'win32'
    this.updater.logger = console
    this.updater.setFeedURL(resolveElectronUpdaterFeedUrl(options.updateFeedUrl))

    this.updater.on('checking-for-update', () => {
      this.onStatusChanged({
        isCheckingForUpdates: true,
        errorMessage: null,
      })
    })
    this.updater.on('update-available', (info) => {
      this.latestUpdateInfo = info
      this.downloadedFilePath = null
      this.onStatusChanged({
        isCheckingForUpdates: false,
        updateInfo: projectUpdateInfo(info, this.artifactType),
        updateDownloaded: false,
      })
    })
    this.updater.on('update-not-available', () => {
      this.latestUpdateInfo = null
      this.downloadedFilePath = null
      this.onStatusChanged({
        isCheckingForUpdates: false,
        updateInfo: null,
        updateDownloaded: false,
      })
    })
    this.updater.on('download-progress', (progress) => {
      if (!this.projectedTaskId) { return }
      void this.downloadCenter?.reportExternal(this.projectedTaskId, {
        status: 'downloading',
        transferredBytes: progress.transferred,
        totalBytes: progress.total || null,
      })
    })
    this.updater.on('update-downloaded', (event) => {
      this.downloadedFilePath = event.downloadedFile
      if (this.projectedTaskId) {
        void this.downloadCenter?.reportExternal(this.projectedTaskId, { status: 'completed' })
      }
      this.onStatusChanged({
        updateDownloaded: true,
      })
    })
    this.updater.on('error', (_error) => {
      if (this.projectedTaskId) {
        void this.downloadCenter?.reportExternal(this.projectedTaskId, {
          status: this.cancellationToken?.cancelled ? 'cancelled' : 'failed',
          error: {
            code: this.cancellationToken?.cancelled ? 'cancelled' : 'updater_error',
            message: this.cancellationToken?.cancelled ? 'The download was cancelled.' : 'The desktop updater could not download the update.',
            retryable: !this.cancellationToken?.cancelled,
          },
        })
      }
      this.onStatusChanged({
        isCheckingForUpdates: false,
        errorMessage: 'The desktop updater could not download the update.',
      })
    })
  }

  async checkForUpdates(): Promise<DesktopUpdateInfo | null> {
    const result = await this.updater.checkForUpdates()
    if (!result?.isUpdateAvailable) {
      this.latestUpdateInfo = null
      return null
    }
    this.latestUpdateInfo = result.updateInfo
    return projectUpdateInfo(result.updateInfo, this.artifactType)
  }

  setDownloadCenter(downloadCenter: Pick<DesktopDownloadCenterService, 'beginExternal' | 'reportExternal'>): void {
    this.downloadCenter = downloadCenter
  }

  async downloadUpdate(): Promise<string | null> {
    if (this.downloadCenter && this.latestUpdateInfo) {
      const task = await this.downloadCenter.beginExternal(
        createDownloadRequest(
          this.latestUpdateInfo,
          this.updateFeedUrl,
          this.platform,
          this.artifactType,
        ),
        () => this.cancelDownload(),
      )
      this.projectedTaskId = task.taskId
    }
    this.cancellationToken = new ElectronUpdaterCancellationToken()
    try {
      const paths = await this.updater.downloadUpdate(this.cancellationToken)
      return paths[0] ?? this.downloadedFilePath
    }
    catch {
      if (this.projectedTaskId) {
        await this.downloadCenter?.reportExternal(this.projectedTaskId, {
          status: this.cancellationToken.cancelled ? 'cancelled' : 'failed',
          error: {
            code: this.cancellationToken.cancelled ? 'cancelled' : 'updater_error',
            message: this.cancellationToken.cancelled ? 'The download was cancelled.' : 'The desktop updater could not download the update.',
            retryable: !this.cancellationToken.cancelled,
          },
        })
      }
      throw new Error('The desktop updater could not download the update.')
    }
    finally {
      this.cancellationToken = null
      this.projectedTaskId = null
    }
  }

  cancelDownload(): boolean {
    if (!this.cancellationToken) {
      return false
    }
    this.cancellationToken.cancel()
    return true
  }

  applyUpdate(): void {
    this.updater.quitAndInstall(false, true)
  }
}

function createDownloadRequest(
  info: UpdateInfo,
  updateFeedUrl: string,
  platform: ElectronUpdaterPlatform,
  artifactType: ElectronUpdaterArtifactType,
) {
  const file = info.files.find(candidate => hasArtifactExtension(candidate.url, artifactType))
  if (!file || !file.size || file.size <= 0) {
    throw new Error(`${artifactType} update file with a valid size is required`)
  }
  const artifactUrl = new URL(file.url, resolveElectronUpdaterFeedUrl(updateFeedUrl))
  return {
    owner: {
      namespace: 'desktop-update',
      resourceType: platform === 'linux' ? 'linux-update' : 'windows-update',
      resourceId: info.version,
      displayName: `Cradle ${info.version}`,
    },
    fileName: decodeURIComponent(path.posix.basename(artifactUrl.pathname)) || defaultArtifactName(info.version, artifactType),
    sources: [{ id: 'electron-updater', url: artifactUrl.toString() }],
    integrity: file.sha512 ? { expectedBytes: file.size, checksum: { algorithm: 'sha512' as const, value: file.sha512 } } : { expectedBytes: file.size },
    maxBytes: file.size,
  }
}

function defaultArtifactName(version: string, artifactType: ElectronUpdaterArtifactType): string {
  return `Cradle-${version}.${artifactType}`
}

function projectUpdateInfo(
  info: UpdateInfo,
  artifactType: ElectronUpdaterArtifactType,
): DesktopUpdateInfo {
  return {
    version: info.version,
    releaseName: info.releaseName ?? null,
    releaseNotes: projectReleaseNotes(info.releaseNotes),
    releaseDate: info.releaseDate,
    files: info.files
      .filter(file => hasArtifactExtension(file.url, artifactType))
      .map(projectUpdateFile),
  }
}

function hasArtifactExtension(url: string, artifactType: ElectronUpdaterArtifactType): boolean {
  const pathname = new URL(url, 'https://updates.invalid/').pathname
  return pathname.toLowerCase().endsWith(`.${artifactType.toLowerCase()}`)
}

function readArtifactType(platform: ElectronUpdaterPlatform): ElectronUpdaterArtifactType {
  if (platform === 'win32') {
    return 'exe'
  }

  try {
    const packageType = readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim()
    if (packageType === 'deb' || packageType === 'rpm') {
      return packageType
    }
  }
  catch {
    // AppImage builds intentionally do not contain electron-updater's package-type marker.
  }

  return 'AppImage'
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
