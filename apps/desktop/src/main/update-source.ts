import { compare, valid } from 'semver'
import { z } from 'zod'

import type {
  DesktopUpdateArtifact,
  DesktopUpdateCandidate,
  DesktopUpdateFile,
  DesktopUpdateInfo,
  DesktopUpdateManifest,
} from './update-types'

const DEFAULT_MANIFEST_PATH = 'macos/manifest.json'

declare const __CRADLE_DESKTOP_UPDATE_URL__: string

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const updateArtifactSchema = z.object({
  url: z.string().url(),
  size: z.number().int().nonnegative().nullable().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
  platform: z.literal('darwin').nullable().optional(),
  arch: z.union([
    z.literal('arm64'),
    z.literal('x64'),
    z.literal('universal'),
  ]).nullable().optional(),
})

const updateManifestSchema = z.object({
  version: z.string().min(1),
  releaseName: z.string().nullable().optional(),
  releaseNotes: z.string().nullable().optional(),
  releaseDate: z.string().nullable().optional(),
  minSupportedVersion: z.string().nullable().optional(),
  files: z.array(updateArtifactSchema).min(1),
})

export type DesktopUpdateSourceOptions = {
  updateFeedUrl?: string | null
  currentVersion: string
  fetchFn?: FetchFn
}

export class DesktopUpdateSource {
  private readonly currentVersion: string
  private readonly manifestUrl: string
  private readonly fetchFn: FetchFn

  constructor(options: DesktopUpdateSourceOptions) {
    const updateFeedUrl = options.updateFeedUrl ?? readUpdateFeedUrl()
    if (!updateFeedUrl) {
      throw new Error('CRADLE_DESKTOP_UPDATE_URL is not configured')
    }

    this.currentVersion = options.currentVersion
    this.manifestUrl = resolveManifestUrl(updateFeedUrl)
    this.fetchFn = options.fetchFn ?? fetch
  }

  async checkForUpdates(): Promise<DesktopUpdateCandidate | null> {
    const manifest = await this.readManifest()

    if (
      manifest.minSupportedVersion
      && compareVersion(this.currentVersion, manifest.minSupportedVersion) < 0
    ) {
      throw new Error(`Current version ${this.currentVersion} is older than the supported update floor ${manifest.minSupportedVersion}`)
    }

    if (compareVersion(manifest.version, this.currentVersion) <= 0) {
      return null
    }

    const artifact = this.selectArtifact(manifest)
    return {
      info: projectUpdateInfo(manifest),
      artifact,
    }
  }

  private async readManifest(): Promise<DesktopUpdateManifest> {
    const response = await this.fetchFn(this.manifestUrl, {
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Update manifest request failed with HTTP ${response.status}: ${this.manifestUrl}`)
    }

    const parsed = updateManifestSchema.safeParse(await response.json())
    if (!parsed.success) {
      throw new Error(`Update manifest is invalid: ${z.prettifyError(parsed.error)}`)
    }

    return {
      version: parsed.data.version,
      releaseName: parsed.data.releaseName ?? null,
      releaseNotes: parsed.data.releaseNotes ?? null,
      releaseDate: parsed.data.releaseDate ?? null,
      minSupportedVersion: parsed.data.minSupportedVersion ?? null,
      files: parsed.data.files.map(file => ({
        url: file.url,
        size: file.size ?? null,
        sha256: file.sha256 ?? null,
        platform: file.platform ?? null,
        arch: file.arch ?? null,
      })),
    }
  }

  private selectArtifact(manifest: DesktopUpdateManifest): DesktopUpdateArtifact {
    const platformMatches = manifest.files.filter(file => file.platform === null || file.platform === 'darwin')
    const arch = process.arch
    const archMatches = platformMatches.filter(file => file.arch === null || file.arch === arch || file.arch === 'universal')
    const artifact = archMatches[0]

    if (!artifact) {
      throw new Error(`Update ${manifest.version} does not include a macOS artifact for ${arch}`)
    }

    return artifact
  }
}

export function readUpdateFeedUrl(): string | null {
  const url = (process.env.CRADLE_DESKTOP_UPDATE_URL ?? __CRADLE_DESKTOP_UPDATE_URL__).trim()
  return url || null
}

function resolveManifestUrl(updateFeedUrl: string): string {
  if (updateFeedUrl.endsWith('.json')) {
    return updateFeedUrl
  }

  const baseUrl = updateFeedUrl.endsWith('/') ? updateFeedUrl : `${updateFeedUrl}/`
  return new URL(DEFAULT_MANIFEST_PATH, baseUrl).toString()
}

function projectUpdateInfo(manifest: DesktopUpdateManifest): DesktopUpdateInfo {
  return {
    version: manifest.version,
    releaseName: manifest.releaseName,
    releaseNotes: manifest.releaseNotes,
    releaseDate: manifest.releaseDate,
    files: manifest.files.map(projectUpdateFile),
  }
}

function projectUpdateFile(file: DesktopUpdateArtifact): DesktopUpdateFile {
  return {
    url: file.url,
    size: file.size,
    sha512: null,
  }
}

function compareVersion(left: string, right: string): number {
  const normalizedLeft = valid(left)
  const normalizedRight = valid(right)

  if (!normalizedLeft || !normalizedRight) {
    throw new Error(`Desktop updates require SemVer-compatible versions, received "${left}" and "${right}"`)
  }

  return compare(normalizedLeft, normalizedRight)
}
