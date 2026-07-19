import type { SparkleBridge } from 'electron-sparkle-updater'
import { loadSparkleBridgeForApp } from 'electron-sparkle-updater'
import { compare, valid } from 'semver'

import {
  readSparkleAppcastUrl,
  readSparklePublicEdKey,
  readUpdateFeedUrl,
} from './update-feed'
import type { DesktopUpdateFile, DesktopUpdateInfo } from './update-types'

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type MacOSSparkleUpdateAdapterOptions = {
  updateFeedUrl?: string | null
  appcastUrl?: string | null
  publicEdKey?: string | null
  currentVersion: string
  fetchFn?: FetchFn
  loadBridge?: typeof loadSparkleBridgeForApp
  log?: (message: string) => void
}

export type MacOSSparkleInitResult = {
  ready: boolean
  errorMessage: string | null
}

type AppcastItem = {
  version: string
  releaseName: string | null
  releaseNotes: string | null
  releaseDate: string | null
  files: DesktopUpdateFile[]
}

/**
 * macOS update transport owned by Sparkle via electron-sparkle-updater.
 *
 * Cradle still owns the renderer-visible status model. Sparkle owns download /
 * install / relaunch once the native bridge is initialized.
 */
export class MacOSSparkleUpdateAdapter {
  private readonly currentVersion: string
  private readonly appcastUrl: string | null
  private readonly publicEdKey: string | null
  private readonly fetchFn: FetchFn
  private readonly loadBridge: typeof loadSparkleBridgeForApp
  private readonly log: (message: string) => void
  private bridge: SparkleBridge | null = null
  private initialized = false
  private initError: string | null = null

  constructor(options: MacOSSparkleUpdateAdapterOptions) {
    this.currentVersion = options.currentVersion
    this.appcastUrl = options.appcastUrl ?? readSparkleAppcastUrl(options.updateFeedUrl ?? readUpdateFeedUrl())
    this.publicEdKey = options.publicEdKey ?? readSparklePublicEdKey()
    this.fetchFn = options.fetchFn ?? fetch
    this.loadBridge = options.loadBridge ?? loadSparkleBridgeForApp
    this.log = options.log ?? ((message: string) => console.log(`[sparkle] ${message}`))
  }

  get isReady(): boolean {
    return this.initialized && this.bridge !== null
  }

  get lastInitError(): string | null {
    return this.initError
  }

  async initialize(): Promise<MacOSSparkleInitResult> {
    if (this.initialized) {
      return {
        ready: this.bridge !== null,
        errorMessage: this.initError,
      }
    }

    this.initialized = true

    if (!this.appcastUrl) {
      this.initError = 'CRADLE_DESKTOP_SPARKLE_APPCAST_URL / CRADLE_DESKTOP_UPDATE_URL is not configured'
      return { ready: false, errorMessage: this.initError }
    }

    if (new URL(this.appcastUrl).protocol !== 'https:' && process.env.CRADLE_DESKTOP_ALLOW_DEV_UPDATES !== 'true') {
      this.initError = 'Desktop Sparkle appcast URL must use HTTPS'
      return { ready: false, errorMessage: this.initError }
    }

    if (!this.publicEdKey) {
      this.initError = 'SPARKLE_ED_PUBLIC_KEY is not configured'
      return { ready: false, errorMessage: this.initError }
    }

    const bridge = await this.loadBridge(this.log)
    if (!bridge) {
      this.initError = 'Sparkle bridge is unavailable (rebuild electron-sparkle-updater for this Electron ABI)'
      return { ready: false, errorMessage: this.initError }
    }

    const ok = bridge.init({
      appcastUrl: this.appcastUrl,
      publicEdKey: this.publicEdKey,
    })
    if (!ok) {
      this.initError = 'Sparkle failed to initialize with the configured appcast and public key'
      return { ready: false, errorMessage: this.initError }
    }

    this.bridge = bridge
    this.initError = null
    return { ready: true, errorMessage: null }
  }

  setAutomaticChecks(enabled: boolean): void {
    this.bridge?.setAutomaticChecks(enabled)
  }

  /**
   * Opens Sparkle's native update UI. Sparkle owns discovery + download from here.
   */
  checkForUpdatesWithUI(): void {
    if (!this.bridge) {
      throw new Error(this.initError ?? 'Sparkle bridge is not ready')
    }
    this.bridge.checkForUpdates()
  }

  /**
   * Best-effort status probe by reading the appcast directly so Settings can show
   * an available version without waiting for Sparkle UI callbacks (the bridge has
   * no progress/event API yet).
   */
  async probeForUpdate(): Promise<DesktopUpdateInfo | null> {
    if (!this.appcastUrl) {
      throw new Error('Sparkle appcast URL is not configured')
    }

    const response = await this.fetchFn(this.appcastUrl, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`Sparkle appcast request failed with HTTP ${response.status}: ${this.appcastUrl}`)
    }

    const xml = await response.text()
    const items = parseSparkleAppcast(xml)
    if (items.length === 0) {
      return null
    }

    const newest = items.reduce((best, item) => (
      compareVersion(item.version, best.version) > 0 ? item : best
    ))

    if (compareVersion(newest.version, this.currentVersion) <= 0) {
      return null
    }

    return {
      version: newest.version,
      releaseName: newest.releaseName,
      releaseNotes: newest.releaseNotes,
      releaseDate: newest.releaseDate,
      files: newest.files,
    }
  }

  installUpdateNow(): void {
    if (!this.bridge) {
      throw new Error(this.initError ?? 'Sparkle bridge is not ready')
    }
    this.bridge.installUpdateNow()
  }
}

export function parseSparkleAppcast(xml: string): AppcastItem[] {
  const items: AppcastItem[] = []
  const itemRegex = /<item\b[\s\S]*?<\/item>/gi
  for (const match of xml.matchAll(itemRegex)) {
    const block = match[0]
    const enclosure = readEnclosure(block)
    const version = (
      enclosure?.shortVersion
      ?? enclosure?.version
      ?? readTag(block, 'sparkle:shortVersionString')
      ?? readTag(block, 'sparkle:version')
      ?? extractSemver(readTag(block, 'title'))
    )?.trim()
    if (!version || !valid(version)) {
      continue
    }

    items.push({
      version,
      releaseName: readTag(block, 'title'),
      releaseNotes: readCdataOrText(block, 'description') ?? readCdataOrText(block, 'sparkle:releaseNotesLink'),
      releaseDate: readTag(block, 'pubDate'),
      files: enclosure
        ? [{
            url: enclosure.url,
            size: enclosure.length,
            sha512: null,
          }]
        : [],
    })
  }
  return items
}

function extractSemver(value: string | null): string | null {
  if (!value) {
    return null
  }
  const match = /\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?/i.exec(value)
  return match?.[0] ?? null
}

function readTag(xml: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i')
  const match = re.exec(xml)
  if (!match) {
    return null
  }
  return decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() || null
}

function readCdataOrText(xml: string, tag: string): string | null {
  return readTag(xml, tag)
}

function readEnclosure(xml: string): {
  url: string
  length: number | null
  version: string | null
  shortVersion: string | null
} | null {
  const match = /<enclosure\b([^>]*)>/i.exec(xml)
  if (!match) {
    return null
  }
  const attrs = match[1]
  const url = readAttr(attrs, 'url')
  if (!url) {
    return null
  }
  const lengthRaw = readAttr(attrs, 'length')
  const length = lengthRaw && /^\d+$/.test(lengthRaw) ? Number(lengthRaw) : null
  return {
    url,
    length,
    version: readAttr(attrs, 'sparkle:version') ?? readAttr(attrs, 'version'),
    shortVersion: readAttr(attrs, 'sparkle:shortVersionString') ?? readAttr(attrs, 'shortVersionString'),
  }
}

function readAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')
  const match = re.exec(attrs)
  if (!match) {
    return null
  }
  return match[2] ?? match[3] ?? null
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
}

function compareVersion(left: string, right: string): number {
  const normalizedLeft = valid(left)
  const normalizedRight = valid(right)
  if (!normalizedLeft || !normalizedRight) {
    throw new Error(`Desktop updates require SemVer-compatible versions, received "${left}" and "${right}"`)
  }
  return compare(normalizedLeft, normalizedRight)
}
