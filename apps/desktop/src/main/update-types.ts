export type DesktopUpdateProvider = 'sparkle' | 'electron-updater' | null

export type DesktopUpdateFile = {
  url: string
  size: number | null
  sha512: string | null
}

export type DesktopUpdateInfo = {
  version: string
  releaseName: string | null
  releaseNotes: string | null
  releaseDate: string | null
  files: DesktopUpdateFile[]
}

export type DesktopUpdateStatus = {
  unsupported: boolean
  /** Transport owner for the current platform, when updates are supported. */
  provider: DesktopUpdateProvider
  currentVersion: string
  isCheckingForUpdates: boolean
  isPreparingUpdate: boolean
  updateDownloaded: boolean
  updateInfo: DesktopUpdateInfo | null
  errorMessage: string | null
}

export type DesktopUpdatePreferences = {
  autoCheckForUpdates: boolean
  autoDownloadUpdates: boolean
}

export function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
