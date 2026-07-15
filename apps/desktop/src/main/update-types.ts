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

export type DesktopUpdateArtifact = {
  url: string
  size: number | null
  sha256: string | null
  platform: 'darwin' | null
  arch: NodeJS.Architecture | 'universal' | null
}

export type DesktopUpdateManifest = {
  version: string
  releaseName: string | null
  releaseNotes: string | null
  releaseDate: string | null
  minSupportedVersion: string | null
  files: DesktopUpdateArtifact[]
}

export type DesktopUpdateCandidate = {
  info: DesktopUpdateInfo
  artifact: DesktopUpdateArtifact
}

export type DesktopUpdateDownload = {
  artifact: DesktopUpdateArtifact
  archivePath: string
}

export type DesktopUpdateInstallerPlan = {
  version: string
  archivePath: string
  stagingRoot: string
  stagedAppPath: string
  targetAppPath: string
  scriptPath: string
  resultPath: string
  usesAdministratorPrivileges: boolean
}

export type DesktopUpdateApplyResult = {
  ok: boolean
  version: string
  error: string | null
  finishedAt: string
}

export function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
