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

export type DesktopUpdateDownloadProgress = {
  /**
   * Sparkle-owned transfer state. `download` counts bytes across the whole
   * delta chain; `apply` reports patch application/extraction. A fallback to
   * the full archive restarts the range (`fallback` is true on its first event).
   */
  phase: 'download' | 'apply'
  percent: number | null
  transferred: number | null
  total: number | null
  fallback: boolean
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
  /**
   * Live download/apply progress for transports that own the download
   * themselves (Sparkle). Windows/Linux electron-updater downloads stream
   * through Download Center tasks instead, so this stays null there.
   */
  downloadProgress: DesktopUpdateDownloadProgress | null
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
